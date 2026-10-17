//! SQLite storage: versioned migrations for the vault schema (ADR-0004).

use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};

use crate::objects::CoreError;

/// All vault migrations, in order. Append-only: never edit a shipped file.
pub fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../migrations/0001_init.sql")),
        M::up(include_str!("../migrations/0002_fts_search.sql")),
        M::up(include_str!("../migrations/0003_versions_snapshots.sql")),
    ])
}

fn storage_error(error: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(error.to_string())
}

/// Opens (or creates) a vault database at `path` and brings it to the latest
/// schema version.
pub fn open_vault(path: &str) -> Result<Connection, CoreError> {
    let mut conn = Connection::open(path).map_err(storage_error)?;
    conn.busy_timeout(std::time::Duration::from_millis(5_000))
        .map_err(storage_error)?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(storage_error)?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(storage_error)?;
    migrations().to_latest(&mut conn).map_err(storage_error)?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::open_vault;

    #[test]
    fn fresh_in_memory_vault_reaches_latest_schema() {
        let conn = open_vault(":memory:").unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert!(version >= 1);
        for table in [
            "objects",
            "object_updates",
            "object_snapshots",
            "blocks",
            "links",
            "tags",
            "object_versions",
            "workspace_snapshots",
        ] {
            let count: i64 = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{table}'"
                    ),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "table {table} missing");
        }
        // FTS5 availability: the virtual table exists and matches.
        let fts: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM fts_objects WHERE fts_objects MATCH 'x'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fts, 0);
    }

    #[test]
    fn migrations_are_idempotent_on_reopen() {
        let dir = std::env::temp_dir();
        let file = dir.join(format!("fossil-core-test-{}.db", ulid::Ulid::generate()));
        let path = file.to_str().unwrap_or_default();
        {
            let conn = open_vault(path).unwrap();
            drop(conn);
        }
        let conn = open_vault(path).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert!(version >= 1);
        drop(conn);
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(format!("{path}-wal"));
        let _ = std::fs::remove_file(format!("{path}-shm"));
    }

    #[test]
    fn sets_busy_timeout_and_migration_0002_backfills_fts_for_unarchived_objects() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../migrations/0001_init.sql"))
            .unwrap();
        conn.execute(
            "INSERT INTO objects(id, types, title, created_at, updated_at, archived)
             VALUES ('01H00000000000000000000001', '[\"page\"]', 'Activa', 1, 1, 0),
                    ('01H00000000000000000000002', '[\"page\"]', 'Archivada', 1, 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO blocks(id, object_id, text, sort_order)
             VALUES ('b1', '01H00000000000000000000001', 'primera linea', 0),
                    ('b2', '01H00000000000000000000001', 'segunda linea', 1)",
            [],
        )
        .unwrap();
        conn.execute_batch(include_str!("../migrations/0002_fts_search.sql"))
            .unwrap();
        let active_hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM fts_objects WHERE fts_objects MATCH 'Activa AND segunda'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let archived_hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM fts_objects WHERE fts_objects MATCH 'Archivada'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(active_hits, 1);
        assert_eq!(archived_hits, 0);

        let vault = open_vault(":memory:").unwrap();
        let timeout: i64 = vault
            .query_row("PRAGMA busy_timeout", [], |r| r.get(0))
            .unwrap();
        assert_eq!(timeout, 5_000);
    }
    #[test]
    fn migration_0003_upgrades_an_existing_vault_and_enforces_trigger_tags() {
        use crate::snapshots::{SnapshotTriggerKind, VersionTriggerKind};

        let file =
            std::env::temp_dir().join(format!("fossil-core-0003-{}.db", ulid::Ulid::generate()));
        let path = file.to_str().unwrap_or_default().to_owned();
        {
            // An R1 vault at schema 2 with a page in it.
            let mut conn = rusqlite::Connection::open(&path).unwrap();
            rusqlite_migration::Migrations::new(vec![
                rusqlite_migration::M::up(include_str!("../migrations/0001_init.sql")),
                rusqlite_migration::M::up(include_str!("../migrations/0002_fts_search.sql")),
            ])
            .to_latest(&mut conn)
            .unwrap();
            conn.execute(
                "INSERT INTO objects(id, types, title, created_at, updated_at, archived)
                 VALUES ('01H00000000000000000000001', '[\"Page\"]', 'Plan Acme', 1, 1, 0)",
                [],
            )
            .unwrap();
        }
        let conn = open_vault(&path).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 3);
        let kept: String = conn
            .query_row("SELECT title FROM objects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kept, "Plan Acme", "existing data survives the upgrade");

        for (i, kind) in VersionTriggerKind::ALL.into_iter().enumerate() {
            conn.execute(
                "INSERT INTO object_versions(version_id, object_id, title, trigger_kind,
                   payload, byte_size, created_at)
                 VALUES (?1, '01H00000000000000000000001', 'Plan Acme', ?2, x'00', 1, ?3)",
                rusqlite::params![format!("v{i}"), kind.as_sql(), i as i64],
            )
            .unwrap();
        }
        for (i, kind) in SnapshotTriggerKind::ALL.into_iter().enumerate() {
            conn.execute(
                "INSERT INTO workspace_snapshots(snapshot_id, snapshot_path, trigger_kind,
                   object_count, attachment_count, total_bytes, created_at)
                 VALUES (?1, '.fossil/backups/s', ?2, 1, 0, 10, ?3)",
                rusqlite::params![format!("s{i}"), kind.as_sql(), i as i64],
            )
            .unwrap();
        }
        let bad_version = conn.execute(
            "INSERT INTO object_versions(version_id, object_id, title, trigger_kind,
               payload, byte_size, created_at)
             VALUES ('bad', '01H00000000000000000000001', 't', 'Manual', x'00', 1, 1)",
            [],
        );
        assert!(bad_version.is_err(), "CHECK rejects unknown version tags");
        let bad_snapshot = conn.execute(
            "INSERT INTO workspace_snapshots(snapshot_id, snapshot_path, trigger_kind,
               object_count, attachment_count, total_bytes, integrity_ok, created_at)
             VALUES ('bad', 'p', 'manual', 0, 0, 0, 2, 1)",
            [],
        );
        assert!(
            bad_snapshot.is_err(),
            "CHECK rejects non-boolean integrity_ok"
        );
        let orphan = conn.execute(
            "INSERT INTO object_versions(version_id, object_id, title, trigger_kind,
               payload, byte_size, created_at)
             VALUES ('orphan', '01H0000000000000000000000Z', 't', 'manual', x'00', 1, 1)",
            [],
        );
        assert!(orphan.is_err(), "versions need an existing object");

        conn.execute("DELETE FROM objects", []).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM object_versions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "versions cascade with their object");
        drop(conn);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{path}{suffix}"));
        }
    }
}
