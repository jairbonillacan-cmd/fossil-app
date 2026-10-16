//! SQLite metadata operations; wire types remain the contract from #15.
use crate::ids::ObjectId;
use crate::objects::{CoreError, MetaPatch, NewObject, ObjectFilter, ObjectMeta};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{Connection, OptionalExtension, Row, params};

pub(crate) fn storage_error(error: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(error.to_string())
}

fn validate_id(id: &ObjectId) -> Result<(), CoreError> {
    id.as_ulid()
        .ok_or_else(|| storage_error("invalid object id"))?;
    Ok(())
}

fn timestamp(row: &Row<'_>, index: usize) -> rusqlite::Result<String> {
    let millis: i64 = row.get(index)?;
    DateTime::from_timestamp_millis(millis)
        .map(|date| date.to_rfc3339_opts(SecondsFormat::Millis, true))
        .ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                index,
                rusqlite::types::Type::Integer,
                Box::new(std::io::Error::other("invalid timestamp")),
            )
        })
}

fn metadata(row: &Row<'_>) -> rusqlite::Result<ObjectMeta> {
    let types: String = row.get(1)?;
    Ok(ObjectMeta {
        id: ObjectId(row.get(0)?),
        types: serde_json::from_str(&types).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                1,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        title: row.get(2)?,
        icon: row.get(3)?,
        parent: row.get::<_, Option<String>>(4)?.map(ObjectId),
        created_at: timestamp(row, 5)?,
        updated_at: timestamp(row, 6)?,
        archived: row.get(7)?,
    })
}

pub fn get(conn: &Connection, id: &ObjectId) -> Result<Option<ObjectMeta>, CoreError> {
    validate_id(id)?;
    conn.query_row(
        "SELECT id,types,title,icon,parent,created_at,updated_at,archived FROM objects WHERE id=?1",
        [&id.0],
        metadata,
    )
    .optional()
    .map_err(storage_error)
}

pub fn create(conn: &Connection, input: NewObject) -> Result<ObjectMeta, CoreError> {
    if let Some(parent) = &input.parent {
        validate_id(parent)?;
    }
    let id = ObjectId::new();
    let now = Utc::now().timestamp_millis();
    let types = serde_json::to_string(&input.types).map_err(storage_error)?;
    conn.execute(
        "INSERT INTO objects(id,types,title,icon,parent,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)",
        params![id.0, types, input.title, input.icon, input.parent.map(|p| p.0), now],
    ).map_err(storage_error)?;
    get(conn, &id)?.ok_or(CoreError::ObjectNotFound(id.0))
}

pub fn list(conn: &Connection, filter: ObjectFilter) -> Result<Vec<ObjectMeta>, CoreError> {
    if let Some(parent) = &filter.parent {
        validate_id(parent)?;
    }
    // JSON equality compares complete enum values, including Builtin/Custom payloads.
    let type_key = filter
        .type_key
        .map(|key| serde_json::to_string(&key))
        .transpose()
        .map_err(storage_error)?;
    if let Some(parent) = filter.parent {
        let mut stmt = conn
            .prepare_cached(
                "SELECT id,types,title,icon,parent,created_at,updated_at,archived FROM objects
             WHERE parent=?1 AND (?2 OR archived=0)
             AND (?3 IS NULL OR instr(lower(title), lower(?3))>0)
             AND (?4 IS NULL OR EXISTS (
               SELECT 1 FROM json_each(objects.types) WHERE
                 CASE WHEN type='text' THEN json_quote(value) ELSE value END = ?4))
             ORDER BY updated_at DESC, id",
            )
            .map_err(storage_error)?;
        return stmt
            .query_map(
                params![parent.0, filter.include_archived, filter.query, type_key],
                metadata,
            )
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_error);
    }
    let mut stmt = conn
        .prepare_cached(
            "SELECT id,types,title,icon,parent,created_at,updated_at,archived FROM objects
         WHERE (?1 OR archived=0)
         AND (?2 IS NULL OR instr(lower(title), lower(?2))>0)
         AND (?3 IS NULL OR EXISTS (
           SELECT 1 FROM json_each(objects.types) WHERE
             CASE WHEN type='text' THEN json_quote(value) ELSE value END = ?3))
         ORDER BY updated_at DESC, id",
        )
        .map_err(storage_error)?;
    stmt.query_map(
        params![filter.include_archived, filter.query, type_key],
        metadata,
    )
    .map_err(storage_error)?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(storage_error)
}

pub fn update(
    conn: &mut Connection,
    id: &ObjectId,
    patch: MetaPatch,
) -> Result<ObjectMeta, CoreError> {
    let tx = conn.transaction().map_err(storage_error)?;
    let mut meta = get(&tx, id)?.ok_or_else(|| CoreError::ObjectNotFound(id.0.clone()))?;
    if let Some(title) = patch.title {
        meta.title = title;
    }
    if let Some(icon) = patch.icon {
        meta.icon = Some(icon);
    }
    if let Some(types) = patch.types {
        meta.types = types;
    }
    if let Some(archived) = patch.archived {
        meta.archived = archived;
    }
    let types = serde_json::to_string(&meta.types).map_err(storage_error)?;
    tx.execute(
        "UPDATE objects SET title=?2,icon=?3,types=?4,archived=?5,updated_at=?6 WHERE id=?1",
        params![
            id.0,
            meta.title,
            meta.icon,
            types,
            meta.archived,
            Utc::now().timestamp_millis()
        ],
    )
    .map_err(storage_error)?;
    let result = get(&tx, id)?.ok_or_else(|| CoreError::ObjectNotFound(id.0.clone()))?;
    tx.commit().map_err(storage_error)?;
    Ok(result)
}

pub fn archive(conn: &mut Connection, id: &ObjectId) -> Result<ObjectMeta, CoreError> {
    update(
        conn,
        id,
        MetaPatch {
            archived: Some(true),
            ..Default::default()
        },
    )
}

/// Moves `id` under `parent` (`None` moves to the root) in one transaction.
///
/// Errors are typed and nothing is written on failure: `ObjectNotFound` (the
/// moved object), `ParentNotFound` (missing parent; ids from another Espacio
/// never exist in this vault's database), `ParentArchived` (parent or any
/// ancestor archived) and `MoveCycle` (into itself, into a descendant, or a
/// pre-existing cycle in the ancestor chain, which also bounds the walk).
/// Idempotent when the parent is unchanged. Sibling order stays the derived
/// `updated_at DESC, id` order: the moved object lands first under its new
/// parent and every other sibling keeps its relative position.
pub fn move_object(
    conn: &mut Connection,
    id: &ObjectId,
    parent: Option<ObjectId>,
) -> Result<ObjectMeta, CoreError> {
    validate_id(id)?;
    if let Some(parent_id) = &parent {
        validate_id(parent_id)?;
    }
    let tx = conn.transaction().map_err(storage_error)?;
    let meta = get(&tx, id)?.ok_or_else(|| CoreError::ObjectNotFound(id.0.clone()))?;
    let mut visited = std::collections::HashSet::from([id.clone()]);
    let mut cursor = parent.clone();
    while let Some(ancestor_id) = cursor {
        if !visited.insert(ancestor_id.clone()) {
            return Err(CoreError::MoveCycle(id.0.clone()));
        }
        let ancestor = get(&tx, &ancestor_id)?.ok_or(CoreError::ParentNotFound(ancestor_id.0))?;
        if ancestor.archived {
            return Err(CoreError::ParentArchived(ancestor.id.0));
        }
        cursor = ancestor.parent;
    }
    if meta.parent == parent {
        return Ok(meta);
    }
    let prev_millis: i64 = tx
        .query_row("SELECT updated_at FROM objects WHERE id=?1", [&id.0], |r| {
            r.get(0)
        })
        .map_err(storage_error)?;
    let max_sibling_millis: Option<i64> = tx
        .query_row(
            "SELECT MAX(updated_at) FROM objects WHERE (?1 IS NULL AND parent IS NULL) OR parent=?1",
            [parent.as_ref().map(|p| p.0.as_str())],
            |r| r.get(0),
        )
        .map_err(storage_error)?;
    let now = Utc::now()
        .timestamp_millis()
        .max(prev_millis.saturating_add(1))
        .max(max_sibling_millis.map_or(0, |m| m.saturating_add(1)));
    tx.execute(
        "UPDATE objects SET parent=?2, updated_at=?3 WHERE id=?1",
        params![id.0, parent.map(|p| p.0), now],
    )
    .map_err(storage_error)?;
    let result = get(&tx, id)?.ok_or_else(|| CoreError::ObjectNotFound(id.0.clone()))?;
    tx.commit().map_err(storage_error)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{objects::TypeKey, storage::open_vault};

    fn page(title: &str, parent: Option<ObjectId>) -> NewObject {
        NewObject {
            types: vec![TypeKey::Page],
            title: title.into(),
            icon: None,
            parent,
        }
    }

    #[test]
    fn metadata_survives_close_and_reopen_with_wal_and_foreign_keys() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("vault.db");
        let mut conn = open_vault(file.to_str().unwrap()).unwrap();
        assert_eq!(
            conn.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "wal"
        );
        assert_eq!(
            conn.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i32>(0))
                .unwrap(),
            1
        );
        let original = create(&conn, page("Original", None)).unwrap();
        let edited = update(
            &mut conn,
            &original.id,
            MetaPatch {
                title: Some("Página 🚀 ' OR 1=1 --".into()),
                icon: Some("📄".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(edited.created_at, original.created_at);
        assert!(edited.created_at.ends_with('Z'));
        assert!(edited.updated_at >= edited.created_at);
        let millis: i64 = conn
            .query_row(
                "SELECT created_at FROM objects WHERE id=?1",
                [&original.id.0],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            DateTime::parse_from_rfc3339(&edited.created_at)
                .unwrap()
                .timestamp_millis(),
            millis
        );
        drop(conn);
        let mut conn = open_vault(file.to_str().unwrap()).unwrap();
        assert_eq!(get(&conn, &original.id).unwrap(), Some(edited));
        let archived = archive(&mut conn, &original.id).unwrap();
        assert!(archived.archived);
        assert!(list(&conn, ObjectFilter::default()).unwrap().is_empty());
        assert_eq!(
            list(
                &conn,
                ObjectFilter {
                    include_archived: true,
                    ..Default::default()
                }
            )
            .unwrap(),
            vec![archived]
        );
    }

    #[test]
    fn filters_match_types_parent_and_literal_query() {
        let conn = open_vault(":memory:").unwrap();
        let parent = create(&conn, page("Parent", None)).unwrap();
        let mut child = page("Child 100%_", Some(parent.id.clone()));
        child.types.push(TypeKey::Builtin("task".into()));
        child.types.push(TypeKey::Custom("local-type".into()));
        let child = create(&conn, child).unwrap();
        for key in [
            TypeKey::Page,
            TypeKey::Builtin("task".into()),
            TypeKey::Custom("local-type".into()),
        ] {
            let result = list(
                &conn,
                ObjectFilter {
                    parent: Some(parent.id.clone()),
                    type_key: Some(key),
                    query: Some("100%_".into()),
                    ..Default::default()
                },
            )
            .unwrap();
            assert_eq!(result, vec![child.clone()]);
        }
        assert!(
            list(
                &conn,
                ObjectFilter {
                    type_key: Some(TypeKey::Journal),
                    ..Default::default()
                }
            )
            .unwrap()
            .is_empty()
        );
        assert_eq!(
            list(
                &conn,
                ObjectFilter {
                    query: Some("CHILD".into()),
                    ..Default::default()
                }
            )
            .unwrap(),
            vec![child]
        );
    }

    #[test]
    fn missing_invalid_and_dangling_ids_do_not_mutate_objects() {
        let mut conn = open_vault(":memory:").unwrap();
        let missing = ObjectId::new();
        assert_eq!(get(&conn, &missing).unwrap(), None);
        assert_eq!(
            archive(&mut conn, &missing).unwrap_err(),
            CoreError::ObjectNotFound(missing.0.clone())
        );
        assert!(create(&conn, page("Dangling", Some(missing))).is_err());
        assert!(get(&conn, &ObjectId("../unsafe".into())).is_err());
        assert!(list(&conn, ObjectFilter::default()).unwrap().is_empty());
    }

    /// Children of `parent` in list order (`updated_at DESC, id`); `None` = root.
    fn children(conn: &Connection, parent: Option<&ObjectId>) -> Vec<ObjectId> {
        all(conn)
            .into_iter()
            .filter(|m| !m.archived && m.parent.as_ref() == parent)
            .map(|m| m.id)
            .collect()
    }

    fn all(conn: &Connection) -> Vec<ObjectMeta> {
        let filter = ObjectFilter {
            include_archived: true,
            ..Default::default()
        };
        list(conn, filter).unwrap()
    }

    #[test]
    fn move_object_reparents_and_keeps_sibling_order_dense_and_stable() {
        let mut conn = open_vault(":memory:").unwrap();
        let a = create(&conn, page("Carpeta A", None)).unwrap().id;
        let b = create(&conn, page("Carpeta B", None)).unwrap().id;
        for title in ["A1", "A3"] {
            create(&conn, page(title, Some(a.clone()))).unwrap();
        }
        let moved = create(&conn, page("A2", Some(a.clone()))).unwrap();
        for title in ["B1", "B2"] {
            create(&conn, page(title, Some(b.clone()))).unwrap();
        }
        let grandchild = create(&conn, page("Nieto", Some(moved.id.clone()))).unwrap();
        let before_a: Vec<_> = children(&conn, Some(&a))
            .into_iter()
            .filter(|id| *id != moved.id)
            .collect();
        let before_b = children(&conn, Some(&b));

        let after = move_object(&mut conn, &moved.id, Some(b.clone())).unwrap();
        assert_eq!(after.parent, Some(b.clone()));
        assert!(after.updated_at > moved.updated_at);
        assert_eq!(
            get(&conn, &grandchild.id).unwrap().unwrap().parent,
            Some(moved.id.clone())
        );
        // Source keeps its relative order; target gets the moved object first,
        // once, ahead of the unchanged previous order (no gaps, no duplicates).
        assert_eq!(children(&conn, Some(&a)), before_a);
        let mut expected_b = vec![moved.id.clone()];
        expected_b.extend(before_b.iter().cloned());
        assert_eq!(children(&conn, Some(&b)), expected_b);

        // Idempotent: same parent changes nothing, not even the timestamp.
        assert_eq!(
            move_object(&mut conn, &moved.id, Some(b.clone())).unwrap(),
            after
        );
        assert_eq!(children(&conn, Some(&b)), expected_b);

        let mut expected_root = vec![moved.id.clone()];
        expected_root.extend(children(&conn, None));
        let at_root = move_object(&mut conn, &moved.id, None).unwrap();
        assert_eq!(at_root.parent, None);
        assert_eq!(children(&conn, None), expected_root);
        assert_eq!(children(&conn, Some(&b)), before_b);
        assert_eq!(move_object(&mut conn, &moved.id, None).unwrap(), at_root);
    }

    #[test]
    fn move_object_rejects_cycles_with_typed_errors_and_writes_nothing() {
        let mut conn = open_vault(":memory:").unwrap();
        let root = create(&conn, page("Raíz", None)).unwrap().id;
        let mid = create(&conn, page("Intermedio", Some(root.clone())))
            .unwrap()
            .id;
        let leaf = create(&conn, page("Hoja", Some(mid.clone()))).unwrap().id;
        let snapshot = all(&conn);
        for target in [&root, &mid, &leaf] {
            assert_eq!(
                move_object(&mut conn, &root, Some(target.clone())),
                Err(CoreError::MoveCycle(root.0.clone()))
            );
        }
        assert_eq!(
            move_object(&mut conn, &mid, Some(leaf.clone())),
            Err(CoreError::MoveCycle(mid.0.clone()))
        );
        assert_eq!(all(&conn), snapshot);
    }

    #[test]
    fn move_object_rejects_missing_foreign_and_archived_parents() {
        let mut conn = open_vault(":memory:").unwrap();
        let leaf = create(&conn, page("Hoja", None)).unwrap().id;
        let missing = ObjectId::new();
        assert_eq!(
            move_object(&mut conn, &leaf, Some(missing.clone())),
            Err(CoreError::ParentNotFound(missing.0.clone()))
        );
        assert_eq!(
            move_object(&mut conn, &missing, None),
            Err(CoreError::ObjectNotFound(missing.0))
        );
        // Each Espacio is its own database: a parent from another one is unknown here.
        let other = open_vault(":memory:").unwrap();
        let foreign = create(&other, page("Ajena", None)).unwrap().id;
        assert_eq!(
            move_object(&mut conn, &leaf, Some(foreign.clone())),
            Err(CoreError::ParentNotFound(foreign.0))
        );
        let trash = create(&conn, page("Archivada", None)).unwrap().id;
        let inside = create(&conn, page("Dentro", Some(trash.clone())))
            .unwrap()
            .id;
        archive(&mut conn, &trash).unwrap();
        for target in [&trash, &inside] {
            assert_eq!(
                move_object(&mut conn, &leaf, Some(target.clone())),
                Err(CoreError::ParentArchived(trash.0.clone()))
            );
        }
        let snapshot = all(&conn);
        let bad = ObjectId("../bad".into());
        assert!(matches!(
            move_object(&mut conn, &bad, None),
            Err(CoreError::Storage(_))
        ));
        assert!(matches!(
            move_object(&mut conn, &leaf, Some(bad)),
            Err(CoreError::Storage(_))
        ));
        assert_eq!(all(&conn), snapshot);
    }

    #[test]
    fn move_object_stops_on_a_corrupted_ancestor_cycle() {
        let mut conn = open_vault(":memory:").unwrap();
        let x = create(&conn, page("X", None)).unwrap().id;
        let y = create(&conn, page("Y", Some(x.clone()))).unwrap().id;
        let z = create(&conn, page("Z", None)).unwrap().id;
        conn.execute("UPDATE objects SET parent=?2 WHERE id=?1", [&x.0, &y.0])
            .unwrap();
        assert_eq!(
            move_object(&mut conn, &z, Some(x)),
            Err(CoreError::MoveCycle(z.0.clone()))
        );
        assert_eq!(get(&conn, &z).unwrap().unwrap().parent, None);
    }
}
