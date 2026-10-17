//! Full-text search IPC contract (#92, spec `docs/specs/r1-search.md`).
//!
//! Stub signature fixed by contract #92; the implementation arrives in #20.
//! Saved filters of the Espacio (`search_filters_*`) come from #127.

use crate::commands::objects::VaultState;
use fossil_core::ids::SavedFilterId;
use fossil_core::saved_filters::{self, SavedFilter, SavedFilterDraft};
use fossil_core::search::{self, SearchError, SearchHit, SearchQuery};

macro_rules! with_vault {
    ($state:expr, |$conn:ident| $body:expr) => {{
        let mut s = $state
            .0
            .lock()
            .map_err(|e| SearchError::Storage(e.to_string()))?;
        s.with_connection(|$conn| Ok($body))?
    }};
}

/// Searches the open vault using FTS5 and inline operators.
#[tauri::command]
#[specta::specta]
pub fn search_query(
    state: tauri::State<'_, VaultState>,
    query: SearchQuery,
) -> Result<Vec<SearchHit>, SearchError> {
    with_vault!(state, |conn| search::search_query(conn, &query))
}

/// Lists the saved search filters of the open Espacio, ordered by name.
#[tauri::command]
#[specta::specta]
pub fn search_filters_list(
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<SavedFilter>, SearchError> {
    with_vault!(state, |conn| saved_filters::list(conn))
}

/// Creates (`id: null`) or replaces a saved search filter by id.
#[tauri::command]
#[specta::specta]
pub fn search_filters_save(
    state: tauri::State<'_, VaultState>,
    filter: SavedFilterDraft,
) -> Result<SavedFilter, SearchError> {
    with_vault!(state, |conn| saved_filters::save(conn, filter))
}

/// Deletes a saved search filter.
#[tauri::command]
#[specta::specta]
pub fn search_filters_delete(
    state: tauri::State<'_, VaultState>,
    id: SavedFilterId,
) -> Result<(), SearchError> {
    with_vault!(state, |conn| saved_filters::delete(conn, &id))
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
