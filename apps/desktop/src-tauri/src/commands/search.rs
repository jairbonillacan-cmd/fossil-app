//! Full-text search IPC contract (#92, spec `docs/specs/r1-search.md`).
//!
//! Stub signature fixed by contract #92; the implementation arrives in #20.

use fossil_core::search::{SearchError, SearchHit, SearchQuery};

/// Searches the open vault using FTS5 and inline operators.
#[tauri::command]
#[specta::specta]
#[allow(unused_variables)] // contract stub: body arrives with #20
pub fn search_query(query: SearchQuery) -> Result<Vec<SearchHit>, SearchError> {
    Err(SearchError::NotImplemented)
}

#[cfg(test)]
mod tests {
    use super::search_query;
    use fossil_core::search::{SearchError, SearchQuery};

    #[test]
    fn stub_returns_not_implemented() {
        let err = search_query(SearchQuery::default()).unwrap_err();
        assert_eq!(err, SearchError::NotImplemented);
    }
}
