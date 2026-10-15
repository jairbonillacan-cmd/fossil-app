//! Markdown mirror writer (#21, ADR-0004): keeps `<vault>/<tree>/<title>.md`
//! in sync with each object. Export only: the CRDT in SQLite is the source of
//! truth. `.fossil/mirror.json` remembers where each object was written, so
//! renames and archives remove the stale file.
use crate::doc_store;
use crate::ids::ObjectId;
use crate::markdown;
use crate::object_store::{self, storage_error};
use crate::objects::{CoreError, ObjectFilter};
use rusqlite::Connection;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

const INDEX: &str = ".fossil/mirror.json";
const MAX_TREE: usize = 10_000;

type Index = BTreeMap<String, String>;

fn read_index(root: &Path) -> Result<Index, CoreError> {
    match fs::read(root.join(INDEX)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(storage_error),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Index::new()),
        Err(e) => Err(storage_error(e)),
    }
}

/// Writes through a temporary file + rename so readers never see half a file.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), CoreError> {
    let dir = path
        .parent()
        .ok_or_else(|| storage_error("invalid mirror path"))?;
    fs::create_dir_all(dir).map_err(storage_error)?;
    let tmp = dir.join(format!(".{}.tmp", ulid::Ulid::generate()));
    fs::write(&tmp, bytes).map_err(storage_error)?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        storage_error(e)
    })
}

/// Only plain relative paths inside the vault (no `..`, no drive, no root).
fn inside(root: &Path, rel: &str) -> Result<PathBuf, CoreError> {
    let rel = Path::new(rel);
    if rel.components().all(|c| matches!(c, Component::Normal(_))) {
        Ok(root.join(rel))
    } else {
        Err(storage_error("mirror path escapes the vault"))
    }
}

fn remove(root: &Path, rel: &str) -> Result<(), CoreError> {
    match fs::remove_file(inside(root, rel)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(storage_error(e)),
        _ => Ok(()),
    }
}

/// The `.md` content [`export`] writes for an object (frontmatter + body),
/// without touching the vault: backs the "Export Markdown" button (#126).
pub fn render_object(conn: &Connection, id: &ObjectId) -> Result<String, CoreError> {
    let meta =
        object_store::get(conn, id)?.ok_or_else(|| CoreError::ObjectNotFound(id.0.clone()))?;
    markdown::render(&meta, &doc_store::load(conn, id)?)
}

fn write_index(root: &Path, index: &Index) -> Result<(), CoreError> {
    write_atomic(
        &root.join(INDEX),
        &serde_json::to_vec_pretty(index).map_err(storage_error)?,
    )
}

fn export_with_index(
    conn: &Connection,
    root: &Path,
    id: &ObjectId,
    index: &mut Index,
) -> Result<Option<String>, CoreError> {
    let previous = index.get(&id.0).cloned();
    let target = match object_store::get(conn, id)? {
        Some(meta) if !meta.archived => {
            let rel = markdown::relative_path(conn, &meta)?
                .to_string_lossy()
                .replace('\\', "/");
            let content = markdown::render(&meta, &doc_store::load(conn, id)?)?;
            Some((rel, content))
        }
        _ => None,
    };
    let written = target.as_ref().map(|(rel, _)| rel.clone());
    // Remove the stale file BEFORE writing: on Windows "plan.md" and "Plan.md"
    // are the same file, so removing afterwards would delete the new export.
    // Never delete `old` when another object in `index` already owns that path.
    if let Some(old) = previous.filter(|old| {
        Some(old) != written.as_ref()
            && !index
                .iter()
                .any(|(other_id, path)| other_id != &id.0 && path.eq_ignore_ascii_case(old))
    }) {
        remove(root, &old)?;
    }
    if let Some((rel, content)) = &target {
        write_atomic(&inside(root, rel)?, content.as_bytes())?;
    }
    match &written {
        Some(rel) => index.insert(id.0.clone(), rel.clone()),
        None => index.remove(&id.0),
    };
    Ok(written)
}

/// Exports one object: writes its `.md`, or removes it when the object is
/// archived or gone. Returns the vault-relative path written, if any.
pub fn export(conn: &Connection, root: &Path, id: &ObjectId) -> Result<Option<String>, CoreError> {
    let mut index = read_index(root)?;
    let written = export_with_index(conn, root, id, &mut index)?;
    write_index(root, &index)?;
    Ok(written)
}

/// Exports an object and all its descendants (a renamed parent moves the
/// folder of every child), reading and writing `mirror.json` once.
pub fn export_tree(conn: &Connection, root: &Path, id: &ObjectId) -> Result<(), CoreError> {
    let mut index = read_index(root)?;
    let mut pending = vec![id.clone()];
    let mut seen = 0;
    while let Some(next) = pending.pop() {
        seen += 1;
        if seen > MAX_TREE {
            return Err(storage_error("object tree too large to mirror at once"));
        }
        export_with_index(conn, root, &next, &mut index)?;
        let filter = ObjectFilter {
            parent: Some(next),
            include_archived: true,
            ..Default::default()
        };
        pending.extend(object_store::list(conn, filter)?.into_iter().map(|m| m.id));
    }
    write_index(root, &index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::objects::{MetaPatch, NewObject, TypeKey};
    use crate::storage::open_vault;

    fn page(conn: &Connection, title: &str, parent: Option<ObjectId>) -> ObjectId {
        let new = NewObject {
            types: vec![TypeKey::Page],
            title: title.into(),
            icon: None,
            parent,
        };
        object_store::create(conn, new).unwrap().id
    }

    fn rename(conn: &mut Connection, id: &ObjectId, title: &str) {
        let patch = MetaPatch {
            title: Some(title.into()),
            ..Default::default()
        };
        object_store::update(conn, id, patch).unwrap();
    }

    #[test]
    fn writes_renames_and_archives_without_leaving_stale_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let mut conn = open_vault(":memory:").unwrap();
        let id = page(&conn, "Borrador", None);
        assert_eq!(
            export(&conn, root, &id).unwrap().as_deref(),
            Some("Borrador.md")
        );
        let md = fs::read_to_string(root.join("Borrador.md")).unwrap();
        assert!(md.contains(&format!("id: \"{}\"", id.0)));

        rename(&mut conn, &id, "Final");
        export(&conn, root, &id).unwrap();
        assert!(!root.join("Borrador.md").exists());
        assert!(root.join("Final.md").exists());
        assert_eq!(
            read_index(root).unwrap().get(&id.0).map(String::as_str),
            Some("Final.md")
        );

        object_store::archive(&mut conn, &id).unwrap();
        assert_eq!(export(&conn, root, &id).unwrap(), None);
        assert!(!root.join("Final.md").exists());
        assert!(read_index(root).unwrap().is_empty());
    }

    #[test]
    fn render_object_matches_the_mirror_file_body_included() {
        use yrs::{
            Doc, ReadTxn, StateVector, Transact, XmlElementPrelim, XmlFragment, XmlTextPrelim,
        };
        let dir = tempfile::tempdir().unwrap();
        let mut conn = open_vault(":memory:").unwrap();
        let id = page(&conn, "Plan", None);
        let doc = Doc::new();
        let body = doc.get_or_insert_xml_fragment("body");
        let update = {
            let mut txn = doc.transact_mut();
            let p = body.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
            p.push_back(&mut txn, XmlTextPrelim::new("Cuerpo de la página"));
            txn.encode_state_as_update_v1(&StateVector::default())
        };
        doc_store::apply_update(&mut conn, &id, &update).unwrap();

        let md = render_object(&conn, &id).unwrap();
        assert!(md.ends_with("\nCuerpo de la página\n"), "{md}");
        export(&conn, dir.path(), &id).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("Plan.md")).unwrap(), md);

        let missing = ObjectId::new();
        assert_eq!(
            render_object(&conn, &missing),
            Err(CoreError::ObjectNotFound(missing.0.clone()))
        );
    }

    #[test]
    fn case_only_rename_keeps_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let mut conn = open_vault(":memory:").unwrap();
        let id = page(&conn, "plan", None);
        export(&conn, root, &id).unwrap();
        rename(&mut conn, &id, "Plan");
        assert_eq!(
            export(&conn, root, &id).unwrap().as_deref(),
            Some("Plan.md")
        );
        let names: Vec<String> = fs::read_dir(root)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".md"))
            .collect();
        assert_eq!(names, vec!["Plan.md".to_string()]);
    }

    #[test]
    fn renaming_a_parent_moves_its_children() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let mut conn = open_vault(":memory:").unwrap();
        let parent = page(&conn, "Proyecto", None);
        let child = page(&conn, "Notas", Some(parent.clone()));
        export_tree(&conn, root, &parent).unwrap();
        assert!(root.join("Proyecto").join("Notas.md").exists());
        rename(&mut conn, &parent, "Proyecto 2");
        export_tree(&conn, root, &parent).unwrap();
        assert!(root.join("Proyecto 2").join("Notas.md").exists());
        assert!(!root.join("Proyecto").join("Notas.md").exists());
        assert!(read_index(root).unwrap().contains_key(&child.0));
    }

    #[test]
    fn index_paths_cannot_escape_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        assert!(inside(dir.path(), "../fuera.md").is_err());
        assert!(inside(dir.path(), "C:/Windows/x.md").is_err());
        assert!(inside(dir.path(), "a/b.md").is_ok());
        // A tampered index entry is never deleted outside the vault.
        let conn = open_vault(":memory:").unwrap();
        let id = page(&conn, "Nota", None);
        fs::create_dir_all(dir.path().join(".fossil")).unwrap();
        fs::write(
            dir.path().join(INDEX),
            format!("{{\"{}\":\"../victima.md\"}}", id.0),
        )
        .unwrap();
        assert!(export(&conn, dir.path(), &id).is_err());
    }

    #[test]
    fn renaming_does_not_delete_file_owned_by_another_object_in_index() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let mut conn = open_vault(":memory:").unwrap();
        let a = page(&conn, "Compartido", None);
        let b = page(&conn, "Temporal", None);
        export(&conn, root, &a).unwrap();
        let mut idx = read_index(root).unwrap();
        idx.insert(b.0.clone(), "Compartido.md".into());
        write_index(root, &idx).unwrap();

        rename(&mut conn, &b, "NuevoNombre");
        export(&conn, root, &b).unwrap();
        assert!(
            root.join("Compartido.md").exists(),
            "file owned by object `a` must not be removed when `b` moves away"
        );
        assert!(root.join("NuevoNombre.md").exists());
    }

    #[test]
    fn mirror_and_sibling_lookup_stay_fast_on_10k_vault() {
        use std::time::Instant;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let mut conn = open_vault(":memory:").unwrap();
        let parent = page(&conn, "Carpeta Raíz", None);
        {
            let tx = conn.transaction().unwrap();
            let mut stmt = tx
                .prepare(
                    "INSERT INTO objects(id,types,title,parent,created_at,updated_at,archived)
                     VALUES(?1,'[\"Page\"]',?2,?3,1,1,0)",
                )
                .unwrap();
            for i in 0..50u128 {
                let id = ulid::Ulid::from_parts(1_000, i + 1).to_string();
                stmt.execute(rusqlite::params![id, format!("Subpágina {i}"), &parent.0])
                    .unwrap();
            }
            for i in 0..9_949u128 {
                let id = ulid::Ulid::from_parts(2_000, i + 1).to_string();
                stmt.execute(rusqlite::params![
                    id,
                    format!("Página Raíz {i}"),
                    Option::<String>::None
                ])
                .unwrap();
            }
            drop(stmt);
            tx.commit().unwrap();
        }
        let parent_meta = object_store::get(&conn, &parent).unwrap().unwrap();

        let t0 = Instant::now();
        let rel = markdown::relative_path(&conn, &parent_meta).unwrap();
        let rel_ms = t0.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(rel, PathBuf::from("Carpeta Raíz.md"));

        let t1 = Instant::now();
        export(&conn, root, &parent).unwrap();
        let export_ms = t1.elapsed().as_secs_f64() * 1000.0;

        let t2 = Instant::now();
        export_tree(&conn, root, &parent).unwrap();
        let tree_ms = t2.elapsed().as_secs_f64() * 1000.0;

        let t3 = Instant::now();
        let children = object_store::list(
            &conn,
            ObjectFilter {
                parent: Some(parent.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        let list_ms = t3.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(children.len(), 50);

        eprintln!(
            "PERF_57: relative_path={rel_ms:.2}ms export={export_ms:.2}ms export_tree={tree_ms:.2}ms list_parent={list_ms:.3}ms"
        );
        assert!(rel_ms < 50.0, "relative_path took {rel_ms:.2}ms");
        assert!(list_ms < 10.0, "list(parent) took {list_ms:.3}ms");
    }
}
