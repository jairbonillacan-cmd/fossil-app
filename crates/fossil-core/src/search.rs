//! Full-text search contract (issue #92, spec `docs/specs/r1-search.md`).
//!
//! Wire types shared by storage, IPC (`search_query`) and the frontend.
//! Operator parsing and FTS5 execution arrive in #20.

use serde::{Deserialize, Serialize};

use crate::ids::ObjectId;
use crate::objects::{CoreError, TypeKey};

/// Default maximum number of hits returned when [`SearchQuery::limit`] is `None`.
pub const DEFAULT_SEARCH_LIMIT: u32 = 50;

/// Upper bound applied to [`SearchQuery::limit`] so callers cannot request unbounded result sets.
pub const MAX_SEARCH_LIMIT: u32 = 200;

/// Full-text search request over the open vault.
///
/// Timestamps use ISO-8601 UTC strings (e.g. `2026-10-14T00:00:00.000Z`)
/// because `specta-typescript` forbids 64-bit integers on the IPC wire.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct SearchQuery {
    /// Raw query string (free text plus inline operators: `"phrase"`,
    /// `-exclude`, `tag:x`, `type:journal`).
    #[serde(default)]
    pub text: String,
    /// Optional filter by object type, combined with any inline `type:` operator.
    pub type_key: Option<TypeKey>,
    /// Optional filter by tag (`tag` or `tag/subtag`), combined with any inline `tag:` operator.
    pub tag: Option<String>,
    /// Optional lower bound (inclusive) on `updated_at` as an ISO-8601 UTC string.
    pub updated_from: Option<String>,
    /// Optional upper bound (inclusive) on `updated_at` as an ISO-8601 UTC string.
    pub updated_to: Option<String>,
    /// Maximum number of hits to return (`None` uses [`DEFAULT_SEARCH_LIMIT`],
    /// clamped to [`MAX_SEARCH_LIMIT`]).
    pub limit: Option<u32>,
}

/// A plain-text segment of a search excerpt, avoiding raw HTML in the WebView.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct SnippetPart {
    pub text: String,
    pub matched: bool,
}

/// A single vault object matching a [`SearchQuery`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct SearchHit {
    pub object_id: ObjectId,
    pub title: String,
    /// Structured excerpt segments (`matched: true` for highlighted terms).
    pub snippet: Vec<SnippetPart>,
    /// Relevance score (higher is more relevant; negated FTS5 `bm25`).
    pub score: f64,
}

/// Typed errors returned by the search subsystem and `search_query` IPC command.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error, Serialize, Deserialize, specta::Type)]
pub enum SearchError {
    /// Fixed in contract #92; implementation arrives in #20.
    #[error("not implemented yet (contract #92)")]
    NotImplemented,
    #[error("no vault is open")]
    VaultNotOpen,
    #[error("invalid search query: {0}")]
    InvalidQuery(String),
    #[error("storage error: {0}")]
    Storage(String),
}

impl From<CoreError> for SearchError {
    fn from(error: CoreError) -> Self {
        match error {
            CoreError::NotImplemented => Self::NotImplemented,
            CoreError::VaultNotOpen => Self::VaultNotOpen,
            CoreError::ObjectNotFound(id) => Self::Storage(format!("object {id} not found")),
            CoreError::Storage(msg) => Self::Storage(msg),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, SearchError, SearchHit, SearchQuery, SnippetPart,
    };
    use crate::ids::ObjectId;
    use crate::objects::{CoreError, TypeKey};
    use crate::storage::open_vault;

    #[test]
    fn search_query_and_hit_round_trip_through_serde() {
        const { assert!(DEFAULT_SEARCH_LIMIT <= MAX_SEARCH_LIMIT) };
        let query = SearchQuery {
            text: "\"plan trimestral\" -borrador tag:roadmap type:page".into(),
            type_key: Some(TypeKey::Page),
            tag: Some("roadmap".into()),
            updated_from: Some("2026-10-01T00:00:00.000Z".into()),
            updated_to: Some("2026-10-31T23:59:59.999Z".into()),
            limit: Some(DEFAULT_SEARCH_LIMIT),
        };
        let json = serde_json::to_value(&query).unwrap();
        assert_eq!(json["type_key"], "Page");
        assert_eq!(json["limit"], 50);
        let back: SearchQuery = serde_json::from_value(json).unwrap();
        assert_eq!(back, query);

        let hit = SearchHit {
            object_id: ObjectId::new(),
            title: "Plan trimestral".into(),
            snippet: vec![
                SnippetPart {
                    text: "Resumen del ".into(),
                    matched: false,
                },
                SnippetPart {
                    text: "plan trimestral".into(),
                    matched: true,
                },
            ],
            score: 12.5,
        };
        let hit_json = serde_json::to_string(&hit).unwrap();
        let hit_back: SearchHit = serde_json::from_str(&hit_json).unwrap();
        assert_eq!(hit_back, hit);
    }

    #[test]
    fn core_error_maps_into_search_error() {
        assert_eq!(
            SearchError::from(CoreError::VaultNotOpen),
            SearchError::VaultNotOpen
        );
        assert_eq!(
            SearchError::from(CoreError::NotImplemented),
            SearchError::NotImplemented
        );
    }

    #[test]
    fn migration_0002_folds_spanish_diacritics_and_enie() {
        let conn = open_vault(":memory:").unwrap();
        conn.execute(
            "INSERT INTO fts_objects(object_id, title, body) VALUES (?1, ?2, ?3)",
            [
                "01J8Z000000000000000000001",
                "Campaña de otoño",
                "Revisión técnica",
            ],
        )
        .unwrap();

        let matched: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM fts_objects WHERE fts_objects MATCH 'campana AND otono AND revision'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(matched, 1);
    }
}
