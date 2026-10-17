//! Consistent workspace snapshots (#161, spec `r1-trust`, ADR-0018).
//!
//! A snapshot lives in `<root>/.fossil/backups/<snapshot_id>/`: `fossil.db`
//! (`VACUUM INTO` over a read-only connection, never a file copy of the live
//! WAL database), `vault.json`, `mirror.json`, `attachments/*` and a
//! `manifest.json` with the SHA-256 of every file. It is built in
//! `<snapshot_id>.partial` and renamed once complete, so a crash never leaves
//! a half-written snapshot that looks sealed.
use crate::{
    attachments::{self, ATTACHMENTS_DIR, MAX_ATTACHMENT_BYTES},
    fs_guard,
    object_store::storage_error,
    objects::CoreError,
    snapshots::{SnapshotTriggerKind, WorkspaceSnapshotMeta},
    vault::VaultSession,
};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{Connection, OpenFlags, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

pub(crate) const MANIFEST: &str = "manifest.json";
const MANIFEST_VERSION: u32 = 1;

/// One file of a snapshot; `path` is relative to the snapshot folder, with `/`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct FileEntry {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct Manifest {
    pub version: u32,
    pub snapshot_id: String,
    pub trigger_kind: String,
    /// Milliseconds since the Unix epoch (UTC).
    pub created_at: i64,
    pub object_count: u32,
    pub attachment_count: u32,
    pub total_bytes: u64,
    pub integrity_ok: bool,
    pub files: Vec<FileEntry>,
}

/// A sealed snapshot on disk, not yet recorded in `workspace_snapshots`.
#[derive(Clone, Debug, PartialEq)]
pub struct SealedSnapshot {
    pub meta: WorkspaceSnapshotMeta,
    trigger: SnapshotTriggerKind,
    created_ms: i64,
}

/// `<root>/.fossil/backups`.
pub(crate) fn backups_dir(root: &Path) -> PathBuf {
    root.join(".fossil").join("backups")
}

/// Accepts only the canonical Ulid spelling: the id becomes a folder name, so
/// anything else (`..`, separators, lowercase variants) is path traversal.
pub(crate) fn valid_snapshot_id(id: &str) -> Result<&str, CoreError> {
    match id.parse::<ulid::Ulid>() {
        Ok(ulid) if ulid.to_string() == id => Ok(id),
        _ => Err(storage_error("invalid snapshot id")),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// SHA-256 and size of a file, streamed.
pub(crate) fn hash_file(path: &Path) -> Result<(String, u64), CoreError> {
    copy_hashed(path, None)
}

/// Streams `src` (never a link) into a new `dst` while hashing what was read,
/// so the hash is of the bytes actually written even if `src` changes.
pub(crate) fn copy_hashed(src: &Path, dst: Option<&Path>) -> Result<(String, u64), CoreError> {
    fs_guard::reject_link(src)?;
    let mut input = fs::File::open(src).map_err(storage_error)?;
    let mut output = dst
        .map(|dst| {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(dst)
        })
        .transpose()
        .map_err(storage_error)?;
    let (mut hasher, mut total, mut buffer) = (Sha256::new(), 0u64, vec![0u8; 64 * 1024]);
    loop {
        let read = input.read(&mut buffer).map_err(storage_error)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        if let Some(output) = output.as_mut() {
            output.write_all(&buffer[..read]).map_err(storage_error)?;
        }
        total += read as u64;
    }
    if let Some(output) = output {
        output.sync_all().map_err(storage_error)?;
    }
    Ok((hex(&hasher.finalize()), total))
}

fn read_only(path: &Path) -> Result<Connection, CoreError> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(storage_error)?;
    conn.busy_timeout(Duration::from_millis(5_000))
        .map_err(storage_error)?;
    Ok(conn)
}

/// Runs `pragma` (`quick_check` or `integrity_check`) on a database file:
/// `true` only when it answers a single `ok`. An unreadable file is `false`.
pub(crate) fn check_database(path: &Path, pragma: &str) -> bool {
    let run = || -> Result<bool, CoreError> {
        let conn = read_only(path)?;
        let mut stmt = conn
            .prepare(&format!("PRAGMA {pragma}"))
            .map_err(storage_error)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_error)?;
        Ok(rows == ["ok"])
    };
    run().unwrap_or(false)
}

/// Copies `src` into `<partial>/<relative>` when it exists; `None` if absent.
fn copy_entry(src: &Path, partial: &Path, relative: &str) -> Result<Option<FileEntry>, CoreError> {
    if fs::symlink_metadata(src).is_err() {
        return Ok(None);
    }
    let dst = partial.join(relative);
    let (sha256, bytes) = copy_hashed(src, Some(&dst))?;
    Ok(Some(FileEntry {
        path: relative.to_owned(),
        sha256,
        bytes,
    }))
}

fn fill(
    root: &Path,
    partial: &Path,
    id: &str,
    trigger: SnapshotTriggerKind,
    created_ms: i64,
) -> Result<Manifest, CoreError> {
    let live = root.join(".fossil").join("fossil.db");
    fs_guard::reject_link(&live)?;
    let snapshot_db = partial.join("fossil.db");
    // ADR-0018: own read-only connection, one `VACUUM INTO`; WAL lets it read a
    // consistent photo while writers keep going, and it never takes the session lock.
    read_only(&live)?
        .execute(
            "VACUUM INTO ?1",
            [snapshot_db
                .to_str()
                .ok_or_else(|| storage_error("invalid snapshot path"))?],
        )
        .map_err(storage_error)?;
    let integrity_ok = check_database(&snapshot_db, "quick_check");
    let object_count: u32 = if integrity_ok {
        read_only(&snapshot_db)?
            .query_row("SELECT COUNT(*) FROM objects", [], |row| row.get(0))
            .map_err(storage_error)?
    } else {
        0
    };
    let (sha256, bytes) = hash_file(&snapshot_db)?;
    let mut files = vec![FileEntry {
        path: "fossil.db".into(),
        sha256,
        bytes,
    }];
    for name in ["vault.json", "mirror.json"] {
        let src = root.join(".fossil").join(name);
        files.extend(copy_entry(&src, partial, name)?);
    }
    let source = root.join(ATTACHMENTS_DIR);
    let mut attachment_count = 0;
    if fs::symlink_metadata(&source).is_ok() {
        fs_guard::reject_link(&source)?;
        fs::create_dir(partial.join(ATTACHMENTS_DIR)).map_err(storage_error)?;
        for entry in fs::read_dir(&source).map_err(storage_error)? {
            let path = entry.map_err(storage_error)?.path();
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let relative = format!("{ATTACHMENTS_DIR}/{name}");
            // Anything that is not a well-formed attachment (or a link, or
            // oversized) was not put there by Fossil: leave it out.
            let copyable = attachments::valid_relative(&relative).is_some()
                && fs_guard::reject_link(&path).is_ok()
                && fs::metadata(&path)
                    .is_ok_and(|meta| meta.is_file() && meta.len() <= MAX_ATTACHMENT_BYTES as u64);
            if copyable && let Some(file) = copy_entry(&path, partial, &relative)? {
                files.push(file);
                attachment_count += 1;
            }
        }
    }
    let manifest = Manifest {
        version: MANIFEST_VERSION,
        snapshot_id: id.to_owned(),
        trigger_kind: trigger.as_sql().to_owned(),
        created_at: created_ms,
        object_count,
        attachment_count,
        total_bytes: files.iter().map(|file| file.bytes).sum(),
        integrity_ok,
        files,
    };
    fs::write(
        partial.join(MANIFEST),
        serde_json::to_vec_pretty(&manifest).map_err(storage_error)?,
    )
    .map_err(storage_error)?;
    Ok(manifest)
}

fn iso(millis: i64) -> String {
    DateTime::from_timestamp_millis(millis)
        .map(|date| date.to_rfc3339_opts(SecondsFormat::Millis, true))
        .unwrap_or_default()
}

/// Builds and seals a snapshot of the vault at `root`. Touches no session
/// connection: record the result with [`record`].
pub fn build(root: &Path, trigger: SnapshotTriggerKind) -> Result<SealedSnapshot, CoreError> {
    let backups = backups_dir(root);
    fs_guard::reject_link(&root.join(".fossil"))?;
    fs_guard::reject_link(&backups)?;
    fs::create_dir_all(&backups).map_err(storage_error)?;
    let id = ulid::Ulid::generate().to_string();
    let partial = backups.join(format!("{id}.partial"));
    fs::create_dir(&partial).map_err(storage_error)?;
    let created_ms = Utc::now().timestamp_millis();
    let sealed = fill(root, &partial, &id, trigger, created_ms)
        .and_then(|manifest| {
            fs::rename(&partial, backups.join(&id)).map_err(storage_error)?;
            Ok(manifest)
        })
        .inspect_err(|_| {
            let _ = fs::remove_dir_all(&partial);
        })?;
    Ok(SealedSnapshot {
        meta: WorkspaceSnapshotMeta {
            snapshot_id: id,
            trigger_kind: trigger,
            object_count: sealed.object_count,
            attachment_count: sealed.attachment_count,
            total_bytes: sealed.total_bytes as f64,
            integrity_ok: sealed.integrity_ok,
            created_at: iso(created_ms),
        },
        trigger,
        created_ms,
    })
}

/// Inserts the snapshot into `workspace_snapshots`. `integrity_ok` is always
/// written explicitly: the column's `DEFAULT 1` must never vouch for a snapshot
/// that was not verified. `snapshot_path` stays relative to the Espacio.
pub fn record(conn: &Connection, sealed: &SealedSnapshot) -> Result<(), CoreError> {
    let meta = &sealed.meta;
    valid_snapshot_id(&meta.snapshot_id)?;
    conn.execute(
        "INSERT INTO workspace_snapshots(snapshot_id, snapshot_path, trigger_kind, object_count,
           attachment_count, total_bytes, integrity_ok, created_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            meta.snapshot_id,
            format!(".fossil/backups/{}", meta.snapshot_id),
            sealed.trigger.as_sql(),
            meta.object_count,
            meta.attachment_count,
            meta.total_bytes as i64,
            i32::from(meta.integrity_ok),
            sealed.created_ms,
        ],
    )
    .map_err(storage_error)?;
    Ok(())
}

/// Snapshots of the open Espacio, newest first. Rows with an unknown trigger
/// tag (hostile or newer data) are skipped.
pub fn list(conn: &Connection) -> Result<Vec<WorkspaceSnapshotMeta>, CoreError> {
    let mut stmt = conn
        .prepare(
            "SELECT snapshot_id, trigger_kind, object_count, attachment_count, total_bytes,
                    integrity_ok, created_at
             FROM workspace_snapshots ORDER BY created_at DESC, snapshot_id DESC",
        )
        .map_err(storage_error)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u32>(2)?,
                row.get::<_, u32>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(storage_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(storage_error)?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, trigger, objects, attachments, bytes, ok, created)| {
            // Ids become folder names: a row with a forged id is dropped.
            valid_snapshot_id(&id).ok()?;
            Some(WorkspaceSnapshotMeta {
                snapshot_id: id,
                trigger_kind: SnapshotTriggerKind::from_sql(&trigger)?,
                object_count: objects,
                attachment_count: attachments,
                total_bytes: bytes as f64,
                integrity_ok: ok == 1,
                created_at: iso(created),
            })
        })
        .collect())
}

pub const KEEP_DAILY: usize = 10;
pub const KEEP_WEEKLY: usize = 4;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// Ids to keep out of `(id, created_ms)` rows: the newest snapshot of each of
/// the last [`KEEP_DAILY`] days, plus the newest of each of the last
/// [`KEEP_WEEKLY`] weeks among the rest.
pub(crate) fn retained(rows: &[(String, i64)]) -> HashSet<String> {
    let mut sorted: Vec<_> = rows.iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
    let mut keep = HashSet::new();
    let mut days = Vec::new();
    for (id, ms) in &sorted {
        let day = ms.div_euclid(DAY_MS);
        if days.len() < KEEP_DAILY && !days.contains(&day) {
            days.push(day);
            keep.insert(id.clone());
        }
    }
    let mut weeks = Vec::new();
    // Weekly slots start where the daily window ends.
    let cutoff = days.iter().min().copied().unwrap_or(i64::MIN);
    let rest: Vec<_> = sorted
        .iter()
        .filter(|(_, ms)| ms.div_euclid(DAY_MS) < cutoff)
        .collect();
    for (id, ms) in rest {
        let week = ms.div_euclid(DAY_MS * 7);
        if weeks.len() < KEEP_WEEKLY && !weeks.contains(&week) {
            weeks.push(week);
            keep.insert(id.clone());
        }
    }
    keep
}

/// `(id, created_ms, is_scheduled, is_valid)` of a `workspace_snapshots` row.
type Row = (String, i64, bool, bool);

/// Ids retention may delete. Only `Scheduled` snapshots rotate: `Manual`,
/// `PreImport` and `PreRestore` are safety nets and are never pruned here.
/// Only valid (`integrity_ok = 1`) ones fill the daily/weekly slots, the newest
/// valid snapshot of any kind is never deleted, and an invalid scheduled one is
/// dropped only once a newer valid snapshot exists.
pub(crate) fn doomed(rows: &[Row]) -> Vec<String> {
    let slots: Vec<_> = rows
        .iter()
        .filter(|row| row.2 && row.3)
        .map(|row| (row.0.clone(), row.1))
        .collect();
    let keep = retained(&slots);
    let newest_valid = rows
        .iter()
        .filter(|row| row.3)
        .max_by_key(|row| (row.1, &row.0));
    rows.iter()
        .filter(|row| row.2 && newest_valid.is_none_or(|newest| newest.0 != row.0))
        .filter(|row| {
            if row.3 {
                !keep.contains(&row.0)
            } else {
                newest_valid.is_some_and(|newest| newest.1 > row.1)
            }
        })
        .map(|row| row.0.clone())
        .collect()
}

/// Deletes the rows [`doomed`] selects and returns their ids; remove the
/// folders with [`remove_dirs`] (outside any lock).
pub fn prune(conn: &Connection) -> Result<Vec<String>, CoreError> {
    let mut stmt = conn
        .prepare(
            "SELECT snapshot_id, created_at, trigger_kind = 'scheduled', integrity_ok = 1
             FROM workspace_snapshots",
        )
        .map_err(storage_error)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(storage_error)?
        .collect::<rusqlite::Result<Vec<Row>>>()
        .map_err(storage_error)?;
    let removed = doomed(&rows);
    for id in &removed {
        conn.execute("DELETE FROM workspace_snapshots WHERE snapshot_id=?1", [id])
            .map_err(storage_error)?;
    }
    Ok(removed)
}

/// Records a freshly built snapshot and prunes, but only if `session` still has
/// `root` open: the copy ran without the lock, and the user may have switched
/// Espacio meanwhile. Otherwise the snapshot folder is discarded and nothing is
/// written to the other Espacio. Returns the ids to [`remove_dirs`].
pub fn commit(
    session: &mut VaultSession,
    root: &Path,
    sealed: &SealedSnapshot,
) -> Result<Vec<String>, CoreError> {
    if session.root() != Some(root) {
        remove_dirs(root, std::slice::from_ref(&sealed.meta.snapshot_id));
        return Err(storage_error(
            "the open Espacio changed during the snapshot",
        ));
    }
    session.with_connection(|conn| {
        record(conn, sealed)?;
        prune(conn)
    })
}

/// Best-effort removal of snapshot folders; ids that are not canonical Ulids
/// are ignored, and nothing is followed through a link.
pub fn remove_dirs(root: &Path, ids: &[String]) {
    let backups = backups_dir(root);
    if fs_guard::reject_link(&backups).is_err() {
        return;
    }
    for id in ids.iter().filter_map(|id| valid_snapshot_id(id).ok()) {
        let dir = backups.join(id);
        if fs_guard::reject_link(&dir).is_ok() {
            let _ = fs::remove_dir_all(dir);
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::{
        doc_store,
        objects::{NewObject, TypeKey},
        storage::open_vault,
    };
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    use yrs::{Doc, Text, Transact};

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nrest";

    pub(crate) fn vault() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join(".fossil")).unwrap();
        fs::write(dir.path().join(".fossil/vault.json"), b"\"Acme\"").unwrap();
        let conn = open_vault(dir.path().join(".fossil/fossil.db").to_str().unwrap()).unwrap();
        (dir, conn)
    }

    #[test]
    fn snapshot_is_sealed_listed_and_matches_its_manifest() {
        let (dir, conn) = vault();
        let name = attachments::save(dir.path(), "a.png", PNG).unwrap();
        fs::write(dir.path().join("attachments/notes.txt"), b"not an image").unwrap();
        let sealed = build(dir.path(), SnapshotTriggerKind::Manual).unwrap();
        record(&conn, &sealed).unwrap();
        let meta = &sealed.meta;
        assert!(meta.integrity_ok && meta.attachment_count == 1);
        let folder = backups_dir(dir.path()).join(&meta.snapshot_id);
        let manifest: Manifest =
            serde_json::from_slice(&fs::read(folder.join(MANIFEST)).unwrap()).unwrap();
        let paths: Vec<_> = manifest.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["fossil.db", "vault.json", name.as_str()]);
        for file in &manifest.files {
            let (sha, bytes) = hash_file(&folder.join(&file.path)).unwrap();
            assert_eq!((sha, bytes), (file.sha256.clone(), file.bytes));
        }
        assert!(!folder.with_extension("partial").exists());
        let path: String = conn
            .query_row("SELECT snapshot_path FROM workspace_snapshots", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(path, format!(".fossil/backups/{}", meta.snapshot_id));
    }

    #[test]
    fn unverified_databases_and_hostile_ids_are_rejected() {
        let (dir, _conn) = vault();
        let bad = dir.path().join("bad.db");
        fs::write(&bad, vec![0xAB; 8192]).unwrap();
        assert!(!check_database(&bad, "quick_check"));
        assert!(!check_database(
            &dir.path().join("missing.db"),
            "quick_check"
        ));
        for id in ["..", "../x", "a/b", "", "01arz3ndektsv4rrffq69g5fav"] {
            assert!(valid_snapshot_id(id).is_err(), "{id}");
        }
        assert!(valid_snapshot_id(&ulid::Ulid::generate().to_string()).is_ok());
    }

    #[test]
    fn retention_keeps_ten_daily_then_four_weekly() {
        // Two per day for 45 days: the newest of each of the last 10 days,
        // then the newest of each of the 4 weeks before that window.
        let rows: Vec<_> = (0..45)
            .flat_map(|d| {
                [
                    (format!("a{d:02}"), d * DAY_MS + 5),
                    (format!("b{d:02}"), d * DAY_MS + 9),
                ]
            })
            .collect();
        let keep = retained(&rows);
        for d in 35..45 {
            assert!(keep.contains(&format!("b{d}")), "daily b{d}");
            assert!(!keep.contains(&format!("a{d}")), "a{d} lost its day");
        }
        assert_eq!(keep.len(), 14, "{keep:?}");
        for week_newest in [34, 27, 20, 13] {
            assert!(
                keep.contains(&format!("b{week_newest}")),
                "weekly b{week_newest}"
            );
        }
        assert!(!keep.contains("b06") && !keep.contains("b33"));
        assert!(retained(&[]).is_empty());
    }

    #[test]
    fn prune_removes_rows_and_folders() {
        let (dir, conn) = vault();
        let mut ids = Vec::new();
        for _ in 0..3 {
            let sealed = build(dir.path(), SnapshotTriggerKind::Scheduled).unwrap();
            record(&conn, &sealed).unwrap();
            ids.push(sealed.meta.snapshot_id);
        }
        // All three were taken today: only the newest survives.
        let removed = prune(&conn).unwrap();
        assert_eq!(removed.len(), 2);
        remove_dirs(dir.path(), &removed);
        remove_dirs(dir.path(), &["../..".into()]);
        for id in &removed {
            assert!(!backups_dir(dir.path()).join(id).exists());
        }
        assert!(backups_dir(dir.path()).join(&ids[2]).exists());
    }

    fn insert(conn: &Connection, trigger: &str, created_ms: i64, ok: i32) -> String {
        let id = ulid::Ulid::generate().to_string();
        conn.execute(
            "INSERT INTO workspace_snapshots VALUES(?1, 'x', ?2, 0, 0, 0, ?3, ?4)",
            params![id, trigger, ok, created_ms],
        )
        .unwrap();
        id
    }

    #[test]
    fn only_valid_scheduled_snapshots_rotate() {
        let (_dir, conn) = vault();
        let day = 40 * DAY_MS;
        for (trigger, at) in [
            ("manual", 0),
            ("manual", 1),
            ("pre_restore", 2),
            ("pre_import", 3),
        ] {
            insert(&conn, trigger, day + at, 1);
        }
        let old = insert(&conn, "scheduled", day + 4, 1);
        insert(&conn, "scheduled", day + 5, 1);
        insert(&conn, "scheduled", day + 6, 0);
        // Same-day Manual/PreRestore/PreImport all survive. Of the scheduled
        // ones only the older valid one loses its day slot; the invalid one is
        // newer than every valid snapshot, so it stays for now.
        assert_eq!(prune(&conn).unwrap(), [old]);
        conn.execute_batch(
            "INSERT INTO workspace_snapshots VALUES('../evil', 'x', 'manual', 0, 0, 0, 1, 1)",
        )
        .unwrap();
        assert_eq!(list(&conn).unwrap().len(), 6);
    }

    #[test]
    fn an_invalid_snapshot_never_displaces_the_last_valid_one() {
        let (_dir, conn) = vault();
        let valid = insert(&conn, "scheduled", 0, 1);
        let invalid: Vec<_> = (50..61)
            .map(|d| insert(&conn, "scheduled", d * DAY_MS, 0))
            .collect();
        assert!(prune(&conn).unwrap().is_empty());
        // A newer valid snapshot lets the invalid ones go; the old valid one keeps
        // its slot and is never the one deleted.
        let newest = insert(&conn, "manual", 70 * DAY_MS, 1);
        let mut removed = prune(&conn).unwrap();
        removed.sort();
        let mut expected = invalid.clone();
        expected.sort();
        assert_eq!(removed, expected);
        assert!(!removed.contains(&valid) && !removed.contains(&newest));
    }

    #[test]
    fn a_snapshot_is_not_recorded_in_another_espacio() {
        let dir = tempfile::tempdir().unwrap();
        let mut session = VaultSession::new(dir.path().join("config.json"));
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        for path in [&a, &b] {
            fs::create_dir(path).unwrap();
        }
        session.create(&a, "A".into()).unwrap();
        let root_a = session.root().unwrap().to_path_buf();
        let sealed = build(&root_a, SnapshotTriggerKind::Manual).unwrap();
        session.create(&b, "B".into()).unwrap();
        assert!(commit(&mut session, &root_a, &sealed).is_err());
        assert!(!backups_dir(&root_a).join(&sealed.meta.snapshot_id).exists());
        let rows = session.with_connection(|conn| list(conn)).unwrap().len();
        assert_eq!(rows, 0);
    }

    #[test]
    fn hot_snapshot_with_concurrent_updates_passes_integrity_check() {
        let (dir, conn) = vault();
        let page = crate::object_store::create(
            &conn,
            NewObject {
                types: vec![TypeKey::Page],
                title: "Nota".into(),
                icon: None,
                parent: None,
            },
        )
        .unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let path = dir.path().join(".fossil/fossil.db");
        let writer = {
            let (stop, id) = (stop.clone(), page.id.clone());
            std::thread::spawn(move || {
                let mut conn = open_vault(path.to_str().unwrap()).unwrap();
                let doc = Doc::new();
                let text = doc.get_or_insert_text("body");
                while !stop.load(Ordering::Relaxed) {
                    let update = {
                        let mut txn = doc.transact_mut();
                        text.push(&mut txn, "hola ");
                        txn.encode_update_v1()
                    };
                    doc_store::apply_update(&mut conn, &id, &update).unwrap();
                }
            })
        };
        for _ in 0..5 {
            let sealed = build(dir.path(), SnapshotTriggerKind::Manual).unwrap();
            let id = &sealed.meta.snapshot_id;
            let db = backups_dir(dir.path()).join(id).join("fossil.db");
            assert!(sealed.meta.integrity_ok && check_database(&db, "integrity_check"));
        }
        stop.store(true, Ordering::Relaxed);
        writer.join().unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_in_place_of_backups_is_refused() {
        let (dir, _conn) = vault();
        let outside = tempfile::tempdir().unwrap();
        crate::fs_guard::tests::make_junction(&backups_dir(dir.path()), outside.path());
        assert!(build(dir.path(), SnapshotTriggerKind::Manual).is_err());
    }
}
