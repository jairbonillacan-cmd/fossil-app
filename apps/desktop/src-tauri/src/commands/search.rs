//! Full-text search IPC contract (#92, spec `docs/specs/r1-search.md`).
//!
//! Stub signature fixed by contract #92; the implementation arrives in #20.

use crate::commands::objects::VaultState;
use fossil_core::search::{self, SearchError, SearchHit, SearchQuery};

/// Searches the open vault using FTS5 and inline operators.
#[tauri::command]
#[specta::specta]
pub fn search_query(
    state: tauri::State<'_, VaultState>,
    query: SearchQuery,
) -> Result<Vec<SearchHit>, SearchError> {
    let mut s = state
        .0
        .lock()
        .map_err(|e| SearchError::Storage(e.to_string()))?;
    s.with_connection(|conn| Ok(search::search_query(conn, &query)))?
}

#[cfg(test)]
mod tests {
    use fossil_core::search::{SearchError, SearchQuery};

    #[test]
    fn stub_returns_not_implemented() {
        let c = fossil_core::storage::open_vault(":memory:").unwrap();
        let hits = fossil_core::search::search_query(&c, &SearchQuery::default()).unwrap();
        assert_eq!(
            (hits.len(), SearchError::NotImplemented),
            (0, SearchError::NotImplemented)
        );
    }
}
