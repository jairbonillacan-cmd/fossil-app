//! SQLite storage: versioned migrations for the vault schema (ADR-0004).

use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};

use crate::objects::CoreError;

/// All vault migrations, in order. Append-only: never edit a shipped file.
pub fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../migrations/0001_init.sql")),
        M::up(include_str!("../migrations/0002_fts_search.sql")),
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
}
