//! Yjs document persistence (#18, ADR-0003): an append-only log of lib0 v1
//! updates per object (`object_updates`), compacted into a single snapshot
//! (`object_snapshots`). Updates are merged at the binary level, so updates
//! whose dependencies have not arrived yet are kept, never dropped.
use crate::ids::ObjectId;
use crate::object_store::{self, storage_error};
use crate::objects::CoreError;
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use yrs::Update;
use yrs::updates::decoder::Decode;

/// Pending updates that trigger a compaction inside `apply_update`. The app
/// also compacts after 30 s of inactivity (`compact`).
pub const COMPACT_AFTER_UPDATES: usize = 200;

/// Maximum size of a single Yjs update accepted by [`apply_update`] (16 MiB).
pub const MAX_UPDATE_BYTES: usize = 16 * 1024 * 1024;

fn ensure_object(conn: &Connection, id: &ObjectId) -> Result<(), CoreError> {
    object_store::get(conn, id)?
        .map(|_| ())
        .ok_or_else(|| CoreError::ObjectNotFound(id.0.clone()))
}

/// Snapshot (if any) followed by the pending updates, plus the last pending seq.
fn parts(conn: &Connection, id: &ObjectId) -> Result<(Vec<Vec<u8>>, Option<i64>), CoreError> {
    let snapshot: Option<Vec<u8>> = conn
        .query_row(
            "SELECT state FROM object_snapshots WHERE object_id=?1",
            [&id.0],
            |r| r.get(0),
        )
        .optional()
        .map_err(storage_error)?;
    let mut stmt = conn
        .prepare("SELECT seq, payload FROM object_updates WHERE object_id=?1 ORDER BY seq")
        .map_err(storage_error)?;
    let updates = stmt
        .query_map([&id.0], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?))
        })
        .map_err(storage_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(storage_error)?;
    let last = updates.last().map(|(seq, _)| *seq);
    let blobs = snapshot
        .into_iter()
        .chain(updates.into_iter().map(|(_, payload)| payload))
        .collect();
    Ok((blobs, last))
}

fn merge(blobs: Vec<Vec<u8>>) -> Result<Vec<u8>, CoreError> {
    yrs::merge_updates_v1(blobs).map_err(|e| storage_error(format!("corrupt Yjs state: {e}")))
}

/// Full document state of an object as one lib0 v1 update (empty doc if never edited).
pub fn load(conn: &Connection, id: &ObjectId) -> Result<Vec<u8>, CoreError> {
    conn.execute_batch("SAVEPOINT fossil_doc_load")
        .map_err(storage_error)?;
    let read = ensure_object(conn, id).and_then(|()| parts(conn, id));
    let (blobs, _) = match read {
        Ok(v) => {
            conn.execute_batch("RELEASE SAVEPOINT fossil_doc_load")
                .map_err(storage_error)?;
            v
        }
        Err(e) => {
            let _ = conn.execute_batch(
                "ROLLBACK TO SAVEPOINT fossil_doc_load; RELEASE SAVEPOINT fossil_doc_load",
            );
            return Err(e);
        }
    };
    merge(blobs)
}

/// Appends one update in its own transaction and bumps `updated_at`.
/// Returns `true` when the log reached [`COMPACT_AFTER_UPDATES`] and was compacted.
pub fn apply_update(
    conn: &mut Connection,
    id: &ObjectId,
    update: &[u8],
) -> Result<bool, CoreError> {
    apply_update_with(conn, id, update, COMPACT_AFTER_UPDATES)
}

pub(crate) fn apply_update_with(
    conn: &mut Connection,
    id: &ObjectId,
    update: &[u8],
    compact_after: usize,
) -> Result<bool, CoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage_error)?;
    let compacted = append_in(&tx, id, update, compact_after)?;
    tx.commit().map_err(storage_error)?;
    Ok(compacted)
}

/// [`apply_update`] inside a caller-owned transaction (e.g. create + template).
pub(crate) fn append_in(
    tx: &Connection,
    id: &ObjectId,
    update: &[u8],
    compact_after: usize,
) -> Result<bool, CoreError> {
    if update.len() > MAX_UPDATE_BYTES {
        return Err(storage_error("Yjs update exceeds 16 MiB limit"));
    }
    // Reject garbage before it can poison every future load of the object.
    Update::decode_v1(update).map_err(|e| storage_error(format!("invalid Yjs update: {e}")))?;
    ensure_object(tx, id)?;
    tx.execute(
        "INSERT INTO object_updates(object_id, payload) VALUES(?1, ?2)",
        params![id.0, update],
    )
    .map_err(storage_error)?;
    tx.execute(
        "UPDATE objects SET updated_at=?2 WHERE id=?1",
        params![id.0, Utc::now().timestamp_millis()],
    )
    .map_err(storage_error)?;
    let pending: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM object_updates WHERE object_id=?1",
            [&id.0],
            |r| r.get(0),
        )
        .map_err(storage_error)?;
    let compacted = usize::try_from(pending).unwrap_or(usize::MAX) >= compact_after;
    if compacted {
        compact_in(tx, id)?;
    }
    Ok(compacted)
}

/// Folds the pending updates into the snapshot (idle compaction). No-op when
/// there is nothing pending or the object no longer exists in this vault.
pub fn compact(conn: &mut Connection, id: &ObjectId) -> Result<(), CoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage_error)?;
    compact_in(&tx, id)?;
    tx.commit().map_err(storage_error)
}

fn compact_in(conn: &Connection, id: &ObjectId) -> Result<(), CoreError> {
    let (blobs, last) = parts(conn, id)?;
    let Some(last) = last else { return Ok(()) };
    let state = merge(blobs)?;
    conn.execute(
        "INSERT INTO object_snapshots(object_id, state, at_seq, created_at) VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(object_id) DO UPDATE SET
           state=excluded.state, at_seq=excluded.at_seq, created_at=excluded.created_at",
        params![id.0, state, last, Utc::now().timestamp_millis()],
    )
    .map_err(storage_error)?;
    conn.execute(
        "DELETE FROM object_updates WHERE object_id=?1 AND seq<=?2",
        params![id.0, last],
    )
    .map_err(storage_error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::objects::{NewObject, TypeKey};
    use crate::storage::open_vault;
    use proptest::prelude::*;
    use yrs::{Doc, GetString, ReadTxn, StateVector, Text, Transact};

    fn new_page(conn: &Connection) -> ObjectId {
        object_store::create(
            conn,
            NewObject {
                types: vec![TypeKey::Page],
                title: "Nota".into(),
                icon: None,
                parent: None,
            },
        )
        .unwrap()
        .id
    }

    /// Edits `doc` and returns the incremental update of that transaction.
    fn edit(doc: &Doc, index: u32, insert: &str, delete: u32) -> Vec<u8> {
        let text = doc.get_or_insert_text("body");
        let mut txn = doc.transact_mut();
        let len = text.len(&txn);
        let at = index.min(len);
        text.remove_range(&mut txn, at, delete.min(len - at));
        text.insert(&mut txn, at, insert);
        txn.encode_update_v1()
    }

    fn text_of(state: &[u8]) -> String {
        let doc = Doc::new();
        let text = doc.get_or_insert_text("body");
        let mut txn = doc.transact_mut();
        txn.apply_update(Update::decode_v1(state).unwrap()).unwrap();
        text.get_string(&txn)
    }

    fn count(conn: &Connection, table: &str, id: &ObjectId) -> i64 {
        conn.query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE object_id=?1"),
            [&id.0],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn content_survives_close_and_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("fossil.db");
        let file = file.to_str().unwrap();
        let mut conn = open_vault(file).unwrap();
        let id = new_page(&conn);
        assert_eq!(text_of(&load(&conn, &id).unwrap()), "");
        let doc = Doc::new();
        for (i, chunk) in ["Hola", " mundo", "!"].iter().enumerate() {
            assert!(
                !apply_update(&mut conn, &id, &edit(&doc, 99, chunk, 0)).unwrap(),
                "{i}"
            );
        }
        drop(conn);
        let conn = open_vault(file).unwrap();
        assert_eq!(text_of(&load(&conn, &id).unwrap()), "Hola mundo!");
    }

    #[test]
    fn compacts_after_n_updates_and_keeps_appending() {
        let mut conn = open_vault(":memory:").unwrap();
        let id = new_page(&conn);
        let doc = Doc::new();
        let flags: Vec<bool> = (0..3)
            .map(|i| {
                apply_update_with(&mut conn, &id, &edit(&doc, 99, &i.to_string(), 0), 3).unwrap()
            })
            .collect();
        assert_eq!(flags, vec![false, false, true]);
        assert_eq!(count(&conn, "object_updates", &id), 0);
        assert_eq!(count(&conn, "object_snapshots", &id), 1);
        apply_update_with(&mut conn, &id, &edit(&doc, 0, ">", 0), 3).unwrap();
        assert_eq!(count(&conn, "object_updates", &id), 1);
        assert_eq!(text_of(&load(&conn, &id).unwrap()), ">012");
        compact(&mut conn, &id).unwrap();
        assert_eq!(count(&conn, "object_updates", &id), 0);
        assert_eq!(text_of(&load(&conn, &id).unwrap()), ">012");
    }

    #[test]
    fn rejects_garbage_missing_objects_and_compacts_nothing_quietly() {
        let mut conn = open_vault(":memory:").unwrap();
        let id = new_page(&conn);
        assert!(apply_update(&mut conn, &id, &[0xff, 0x01, 0x02]).is_err());
        assert!(apply_update(&mut conn, &id, &vec![0u8; MAX_UPDATE_BYTES + 1]).is_err());
        assert_eq!(count(&conn, "object_updates", &id), 0);
        let missing = ObjectId::new();
        let empty = Doc::new()
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        assert_eq!(
            apply_update(&mut conn, &missing, &empty).unwrap_err(),
            CoreError::ObjectNotFound(missing.0.clone())
        );
        assert_eq!(
            load(&conn, &missing).unwrap_err(),
            CoreError::ObjectNotFound(missing.0.clone())
        );
        compact(&mut conn, &missing).unwrap();
        compact(&mut conn, &id).unwrap();
        assert_eq!(count(&conn, "object_snapshots", &id), 0);
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(48))]
        // Two replicas edit concurrently; the store converges whatever the
        // arrival order (even reversed, with missing dependencies at first),
        // with and without intermediate compactions.
        #[test]
        fn concurrent_updates_converge_in_any_order(
            ops_a in prop::collection::vec((0u32..20, "[a-z]{0,3}", 0u32..3), 1..8),
            ops_b in prop::collection::vec((0u32..20, "[A-Z]{0,3}", 0u32..3), 1..8),
            compact_after in 2usize..6,
        ) {
            let (a, b) = (Doc::with_client_id(1), Doc::with_client_id(2));
            let ua: Vec<_> = ops_a.iter().map(|(i, s, d)| edit(&a, *i, s, *d)).collect();
            let ub: Vec<_> = ops_b.iter().map(|(i, s, d)| edit(&b, *i, s, *d)).collect();

            let mut in_order = open_vault(":memory:").unwrap();
            let mut reversed = open_vault(":memory:").unwrap();
            let id1 = new_page(&in_order);
            let id2 = new_page(&reversed);
            for u in ua.iter().chain(&ub) {
                apply_update_with(&mut in_order, &id1, u, compact_after).unwrap();
            }
            for u in ub.iter().rev().chain(ua.iter().rev()) {
                apply_update_with(&mut reversed, &id2, u, compact_after).unwrap();
            }
            compact(&mut reversed, &id2).unwrap();

            let all = merge(ua.iter().chain(&ub).cloned().collect()).unwrap();
            let expected = text_of(&all);
            prop_assert_eq!(text_of(&load(&in_order, &id1).unwrap()), expected.clone());
            prop_assert_eq!(text_of(&load(&reversed, &id2).unwrap()), expected);
        }
    }
}
