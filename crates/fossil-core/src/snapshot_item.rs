//! Restoring a single page or attachment from a sealed snapshot (#161, spec
//! `r1-trust`). Neither ever overwrites in silence: a page that still exists is
//! restored as a copy, or backed up as a `pre_restore` version first; a damaged
//! attachment is moved aside, not deleted.
use crate::{
    attachments::{self, ATTACHMENTS_DIR},
    doc_store, fs_guard,
    ids::ObjectId,
    object_store::{self, storage_error},
    objects::{CoreError, ObjectMeta},
    snapshot_restore::read_manifest,
    snapshot_store::{copy_hashed, hash_file, now_ms, read_only},
    snapshots::RestoreConflictPolicy,
};
use rusqlite::{Connection, TransactionBehavior, params};
use std::{fs, path::Path};

/// Restores `attachments/<name>` from snapshot `id` and returns its relative
/// path. Only entries listed in the manifest are accepted. A live file whose
/// hash matches is left alone; a different (damaged) one is renamed to
/// `<name>.corrupt-<ms>` before the snapshot copy is moved in.
pub fn restore_attachment(root: &Path, id: &str, relative: &str) -> Result<String, CoreError> {
    let name = attachments::valid_relative(relative)
        .ok_or_else(|| storage_error("invalid attachment path"))?;
    let (dir, manifest) = read_manifest(root, id)?;
    let entry = manifest
        .files
        .iter()
        .find(|file| file.path == relative)
        .ok_or_else(|| storage_error("attachment is not part of this snapshot"))?;
    let folder = root.join(ATTACHMENTS_DIR);
    fs_guard::reject_link(&folder)?;
    fs::create_dir_all(&folder).map_err(storage_error)?;
    let live = folder.join(name);
    fs_guard::reject_link(&live)?;
    let exists = fs::symlink_metadata(&live).is_ok();
    if exists && hash_file(&live).is_ok_and(|(sha256, _)| sha256 == entry.sha256) {
        return Ok(relative.to_owned());
    }
    let temporary = folder.join(format!("{name}.restoring-{}", ulid::Ulid::generate()));
    let (sha256, _) = copy_hashed(&dir.join(relative), Some(&temporary))?;
    let moved = (sha256 == entry.sha256)
        .then_some(())
        .ok_or_else(|| storage_error("snapshot attachment does not match its hash"))
        .and_then(|()| {
            if exists {
                fs::rename(&live, folder.join(format!("{name}.corrupt-{}", now_ms())))
                    .map_err(storage_error)?;
            }
            fs::rename(&temporary, &live).map_err(storage_error)
        });
    if moved.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    moved.map(|()| relative.to_owned())
}

fn insert_object(
    tx: &Connection,
    id: &ObjectId,
    meta: &ObjectMeta,
    title: &str,
    now: i64,
) -> Result<(), CoreError> {
    // The snapshot's parent only counts if it still exists here.
    let parent = meta
        .parent
        .as_ref()
        .filter(|parent| object_store::get(tx, parent).is_ok_and(|found| found.is_some()));
    tx.execute(
        "INSERT INTO objects(id,types,title,icon,parent,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)",
        params![
            id.0,
            serde_json::to_string(&meta.types).map_err(storage_error)?,
            title,
            meta.icon,
            parent.map(|p| &p.0),
            now
        ],
    )
    .map_err(storage_error)?;
    Ok(())
}

/// Restores page `object_id` from snapshot `id` into the open Espacio.
/// - Not in the Espacio any more: recreated with its original id.
/// - Still there and `CreateCopy`: a new page titled `"<Título> (restaurada)"`.
/// - Still there and `OverwriteWithBackupVersion`: the current state is saved as
///   a `pre_restore` row of `object_versions`, then replaced (and unarchived).
///
/// Trap: replacing a Yjs history under an editor that has the page open means
/// the editor must reload the document afterwards.
pub fn restore_page(
    root: &Path,
    conn: &mut Connection,
    id: &str,
    object_id: &ObjectId,
    policy: RestoreConflictPolicy,
) -> Result<ObjectMeta, CoreError> {
    object_id
        .as_ulid()
        .ok_or_else(|| storage_error("invalid object id"))?;
    let (dir, manifest) = read_manifest(root, id)?;
    let database = dir.join("fossil.db");
    let intact = manifest
        .files
        .iter()
        .find(|file| file.path == "fossil.db")
        .is_some_and(|file| hash_file(&database).is_ok_and(|(sha256, _)| sha256 == file.sha256));
    if !intact {
        return Err(storage_error("snapshot database does not match its hash"));
    }
    let (meta, state) = {
        let snapshot = read_only(&database)?;
        let meta = object_store::get(&snapshot, object_id)?
            .ok_or_else(|| CoreError::ObjectNotFound(object_id.0.clone()))?;
        (meta, doc_store::load(&snapshot, object_id)?)
    };
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage_error)?;
    let now = now_ms();
    let target = match (object_store::get(&tx, object_id)?, policy) {
        (None, _) => {
            insert_object(&tx, object_id, &meta, &meta.title, now)?;
            object_id.clone()
        }
        (Some(_), RestoreConflictPolicy::CreateCopy) => {
            let copy = ObjectId::new();
            let title = format!("{} (restaurada)", meta.title);
            insert_object(&tx, &copy, &meta, &title, now)?;
            copy
        }
        (Some(current), RestoreConflictPolicy::OverwriteWithBackupVersion) => {
            let backup = doc_store::load(&tx, object_id)?;
            tx.execute(
                "INSERT INTO object_versions(version_id, object_id, title, trigger_kind, payload,
                   plain_excerpt, byte_size, created_at)
                 VALUES(?1, ?2, ?3, 'pre_restore', ?4, '', ?5, ?6)",
                params![
                    ulid::Ulid::generate().to_string(),
                    object_id.0,
                    current.title,
                    backup,
                    backup.len() as i64,
                    now
                ],
            )
            .map_err(storage_error)?;
            for table in ["object_updates", "object_snapshots"] {
                tx.execute(
                    &format!("DELETE FROM {table} WHERE object_id=?1"),
                    [&object_id.0],
                )
                .map_err(storage_error)?;
            }
            tx.execute(
                "UPDATE objects SET title=?2, icon=?3, types=?4, archived=0 WHERE id=?1",
                params![
                    object_id.0,
                    meta.title,
                    meta.icon,
                    serde_json::to_string(&meta.types).map_err(storage_error)?
                ],
            )
            .map_err(storage_error)?;
            object_id.clone()
        }
    };
    doc_store::append_in(&tx, &target, &state, usize::MAX)?;
    let restored = object_store::get(&tx, &target)?.ok_or(CoreError::ObjectNotFound(target.0))?;
    tx.commit().map_err(storage_error)?;
    Ok(restored)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        objects::{NewObject, TypeKey},
        snapshot_store::{backups_dir, build, record, tests::vault},
        snapshots::SnapshotTriggerKind,
    };
    use yrs::{Doc, GetString, Text, Transact, Update, updates::decoder::Decode};

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nrest";

    fn text_of(state: &[u8]) -> String {
        let doc = Doc::new();
        let text = doc.get_or_insert_text("body");
        doc.transact_mut()
            .apply_update(Update::decode_v1(state).unwrap())
            .unwrap();
        text.get_string(&doc.transact())
    }

    fn write(conn: &mut Connection, id: &ObjectId, content: &str) {
        let doc = Doc::new();
        let text = doc.get_or_insert_text("body");
        let update = {
            let mut txn = doc.transact_mut();
            text.push(&mut txn, content);
            txn.encode_update_v1()
        };
        doc_store::apply_update(conn, id, &update).unwrap();
    }

    fn page_with_snapshot() -> (tempfile::TempDir, Connection, ObjectId, String) {
        let (dir, mut conn) = vault();
        let page = object_store::create(
            &conn,
            NewObject {
                types: vec![TypeKey::Page],
                title: "Plan".into(),
                icon: None,
                parent: None,
            },
        )
        .unwrap();
        write(&mut conn, &page.id, "original");
        let sealed = build(dir.path(), SnapshotTriggerKind::Manual).unwrap();
        record(&conn, &sealed).unwrap();
        (dir, conn, page.id, sealed.meta.snapshot_id)
    }

    #[test]
    fn pages_are_copied_or_backed_up_and_never_overwritten_in_silence() {
        let (dir, mut conn, id, snap) = page_with_snapshot();
        write(&mut conn, &id, " editado");
        let copy = restore_page(
            dir.path(),
            &mut conn,
            &snap,
            &id,
            RestoreConflictPolicy::CreateCopy,
        )
        .unwrap();
        assert_eq!(copy.title, "Plan (restaurada)");
        assert_ne!(copy.id, id);
        assert_eq!(
            text_of(&doc_store::load(&conn, &copy.id).unwrap()),
            "original"
        );
        assert_eq!(
            text_of(&doc_store::load(&conn, &id).unwrap()),
            "original editado"
        );

        let policy = RestoreConflictPolicy::OverwriteWithBackupVersion;
        let back = restore_page(dir.path(), &mut conn, &snap, &id, policy).unwrap();
        assert_eq!((back.id.clone(), back.title.as_str()), (id.clone(), "Plan"));
        assert_eq!(text_of(&doc_store::load(&conn, &id).unwrap()), "original");
        let payload: Vec<u8> = conn
            .query_row(
                "SELECT payload FROM object_versions WHERE object_id=?1 AND trigger_kind='pre_restore'",
                [&id.0],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(text_of(&payload), "original editado");
    }

    #[test]
    fn a_page_that_no_longer_exists_comes_back_with_its_id() {
        let (dir, mut conn, id, snap) = page_with_snapshot();
        conn.execute("DELETE FROM objects WHERE id=?1", [&id.0])
            .unwrap();
        let policy = RestoreConflictPolicy::CreateCopy;
        let back = restore_page(dir.path(), &mut conn, &snap, &id, policy).unwrap();
        assert_eq!((back.id.clone(), back.title.as_str()), (id.clone(), "Plan"));
        assert_eq!(text_of(&doc_store::load(&conn, &id).unwrap()), "original");
        let unknown = ObjectId::new();
        assert!(matches!(
            restore_page(dir.path(), &mut conn, &snap, &unknown, policy),
            Err(CoreError::ObjectNotFound(_))
        ));
        let hostile = ObjectId("../x".into());
        assert!(restore_page(dir.path(), &mut conn, &snap, &hostile, policy).is_err());
    }

    #[test]
    fn attachments_restore_only_manifest_entries_and_keep_damaged_files() {
        let (dir, _conn) = vault();
        let image = attachments::save(dir.path(), "a.png", PNG).unwrap();
        let sealed = build(dir.path(), SnapshotTriggerKind::Manual).unwrap();
        let snap = sealed.meta.snapshot_id;
        let live = dir.path().join(&image);
        assert_eq!(
            restore_attachment(dir.path(), &snap, &image).unwrap(),
            image
        );
        fs::write(&live, b"damaged").unwrap();
        restore_attachment(dir.path(), &snap, &image).unwrap();
        assert_eq!(fs::read(&live).unwrap(), PNG);
        let kept = fs::read_dir(dir.path().join(ATTACHMENTS_DIR))
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains(".corrupt-")
            })
            .count();
        assert_eq!(kept, 1);
        fs::remove_file(&live).unwrap();
        restore_attachment(dir.path(), &snap, &image).unwrap();
        assert_eq!(fs::read(&live).unwrap(), PNG);
        for bad in [
            "../a.png",
            "attachments/../../a.png",
            "attachments\\a.png",
            "C:/a.png",
            "/attachments/a.png",
            "attachments/CON.png",
            "attachments/01ARZ3NDEKTSV4RRFFQ69G5FAV.png",
        ] {
            assert!(restore_attachment(dir.path(), &snap, bad).is_err(), "{bad}");
        }
        fs::write(
            backups_dir(dir.path()).join(&snap).join(&image),
            b"tampered",
        )
        .unwrap();
        fs::remove_file(&live).unwrap();
        assert!(restore_attachment(dir.path(), &snap, &image).is_err());
        assert!(!live.exists());
    }
}
