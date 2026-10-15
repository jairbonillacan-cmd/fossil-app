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
    let mut stmt = conn
        .prepare(
            "SELECT id,types,title,icon,parent,created_at,updated_at,archived FROM objects
         WHERE (?1 OR archived=0) AND (?2 IS NULL OR parent=?2)
         AND (?3 IS NULL OR instr(lower(title), lower(?3))>0)
         AND (?4 IS NULL OR EXISTS (
           SELECT 1 FROM json_each(objects.types) WHERE
             CASE WHEN type='text' THEN json_quote(value) ELSE value END = ?4))
         ORDER BY updated_at DESC, id",
        )
        .map_err(storage_error)?;
    stmt.query_map(
        params![
            filter.include_archived,
            filter.parent.map(|p| p.0),
            filter.query,
            type_key
        ],
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
}
