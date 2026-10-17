//! Saved search filters of the Espacio (#127, backlog row `r1-search-rank`).
//!
//! A saved filter is a named [`SearchQuery`] stored in the vault (table
//! `saved_search_filters`, migration 0004), so the global search and the
//! palette reuse it. Filters belong to the Espacio, not to a person.
//! Every IPC input is hostile: names and queries are validated here.

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};

use crate::ids::SavedFilterId;
use crate::objects::TypeKey;
use crate::search::{MAX_SEARCH_LIMIT, SearchError, SearchQuery, clean_tag, parse_iso_ms};

/// Maximum length of a filter name, in Unicode scalar values after trimming.
pub const MAX_FILTER_NAME_CHARS: usize = 80;

/// Maximum length of [`SearchQuery::text`] in a saved filter, in Unicode scalar values.
pub const MAX_FILTER_TEXT_CHARS: usize = 1_000;

/// Maximum length of a tag or type key inside a saved filter.
pub const MAX_FILTER_KEY_CHARS: usize = 100;

/// A named search stored in the Espacio.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct SavedFilter {
    pub id: SavedFilterId,
    pub name: String,
    pub query: SearchQuery,
}

/// Payload of `search_filters_save`: `id: None` creates a filter, `Some(id)`
/// replaces that filter (rename and/or new query).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct SavedFilterDraft {
    pub id: Option<SavedFilterId>,
    pub name: String,
    pub query: SearchQuery,
}

fn invalid(msg: impl Into<String>) -> SearchError {
    SearchError::InvalidQuery(msg.into())
}

/// `1..=max` characters, none of them a control character.
fn printable(value: &str, max: usize) -> bool {
    (1..=max).contains(&value.chars().count()) && !value.chars().any(char::is_control)
}

/// Trims and validates a filter name.
pub fn validate_name(raw: &str) -> Result<String, SearchError> {
    let name = raw.trim();
    if !printable(name, MAX_FILTER_NAME_CHARS) {
        return Err(SearchError::InvalidFilterName(format!(
            "must have 1 to {MAX_FILTER_NAME_CHARS} printable characters"
        )));
    }
    Ok(name.to_owned())
}

/// Validates a query before it is saved and returns it with `limit` clamped
/// to [`MAX_SEARCH_LIMIT`], as `search_query` does. `limit: Some(0)` is rejected.
pub fn normalize_query(mut query: SearchQuery) -> Result<SearchQuery, SearchError> {
    if query.text.chars().count() > MAX_FILTER_TEXT_CHARS {
        return Err(invalid(format!(
            "text over {MAX_FILTER_TEXT_CHARS} characters"
        )));
    }
    if let Some(tag) = &query.tag
        && !(printable(tag, MAX_FILTER_KEY_CHARS) && clean_tag(tag).is_some())
    {
        return Err(invalid(format!("invalid tag '{tag}'")));
    }
    if let Some(TypeKey::Builtin(key) | TypeKey::Custom(key)) = &query.type_key
        && !printable(key, MAX_FILTER_KEY_CHARS)
    {
        return Err(invalid(format!("invalid type '{key}'")));
    }
    let (from, to) = (
        parse_iso_ms(&query.updated_from)?,
        parse_iso_ms(&query.updated_to)?,
    );
    if from.zip(to).is_some_and(|(from, to)| from > to) {
        return Err(invalid("updated_from is after updated_to"));
    }
    if query.limit == Some(0) {
        return Err(invalid("limit must be at least 1"));
    }
    query.limit = query.limit.map(|n| n.min(MAX_SEARCH_LIMIT));
    Ok(query)
}

fn parse_id(id: &SavedFilterId) -> Result<String, SearchError> {
    id.as_ulid()
        .map(|u| u.to_string())
        .ok_or_else(|| SearchError::FilterNotFound(id.0.clone()))
}

/// Lists the saved filters of the vault, ordered by name (case-insensitive).
/// Rows with a corrupt id or query are skipped instead of failing the list.
pub fn list(conn: &Connection) -> Result<Vec<SavedFilter>, SearchError> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, name, query FROM saved_search_filters ORDER BY name_key ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((SavedFilterId(r.get(0)?), r.get(1)?, r.get::<_, String>(2)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, name, query) = row?;
        if let (Some(_), Ok(query)) = (id.as_ulid(), serde_json::from_str(&query)) {
            out.push(SavedFilter { id, name, query });
        }
    }
    Ok(out)
}

/// Creates (`draft.id == None`) or replaces a saved filter.
pub fn save(conn: &mut Connection, draft: SavedFilterDraft) -> Result<SavedFilter, SearchError> {
    let name = validate_name(&draft.name)?;
    let query = normalize_query(draft.query)?;
    let json = serde_json::to_string(&query).map_err(|e| SearchError::Storage(e.to_string()))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let id = match &draft.id {
        Some(id) => {
            let id = parse_id(id)?;
            let sql = "SELECT 1 FROM saved_search_filters WHERE id = ?1";
            if tx
                .query_row(sql, [&id], |r| r.get::<_, i64>(0))
                .optional()?
                .is_none()
            {
                return Err(SearchError::FilterNotFound(id));
            }
            id
        }
        None => SavedFilterId::new().0,
    };
    // Unicode lowercase: "Campaña" and "CAMPAÑA" collide (NOCASE only folds ASCII).
    let key = name.to_lowercase();
    let sql = "SELECT 1 FROM saved_search_filters WHERE name_key = ?1 AND id <> ?2";
    if tx
        .query_row(sql, params![key, id], |r| r.get::<_, i64>(0))
        .optional()?
        .is_some()
    {
        return Err(SearchError::DuplicateFilterName(name));
    }
    tx.execute(
        "INSERT INTO saved_search_filters(id, name, name_key, query, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(id) DO UPDATE SET name = ?2, name_key = ?3, query = ?4, updated_at = ?5",
        params![id, name, key, json, Utc::now().timestamp_millis()],
    )?;
    tx.commit()?;
    let id = SavedFilterId(id);
    Ok(SavedFilter { id, name, query })
}

/// Deletes a saved filter; `FilterNotFound` if the id is unknown or malformed.
pub fn delete(conn: &Connection, id: &SavedFilterId) -> Result<(), SearchError> {
    let key = parse_id(id)?;
    match conn.execute("DELETE FROM saved_search_filters WHERE id = ?1", [&key])? {
        0 => Err(SearchError::FilterNotFound(key)),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::open_vault;
    use SearchError::{DuplicateFilterName as Dup, FilterNotFound as NotFound};

    fn draft(id: Option<&SavedFilterId>, name: &str, text: &str) -> SavedFilterDraft {
        let query = SearchQuery {
            text: text.into(),
            ..Default::default()
        };
        SavedFilterDraft {
            id: id.cloned(),
            name: name.into(),
            query,
        }
    }

    fn names(c: &Connection) -> Vec<String> {
        list(c).unwrap().into_iter().map(|f| f.name).collect()
    }

    #[test]
    fn create_list_rename_and_delete() {
        let mut c = open_vault(":memory:").unwrap();
        let a = save(&mut c, draft(None, "  Campaña Q4 ", "tag:campana")).unwrap();
        assert!(
            a.name == "Campaña Q4" && a.id.as_ulid().is_some(),
            "trimmed, Ulid"
        );
        let b = save(&mut c, draft(None, "aprobaciones", "type:journal")).unwrap();
        assert_eq!(names(&c), ["aprobaciones", "Campaña Q4"]);
        let renamed = save(&mut c, draft(Some(&a.id), "Zeta", "otoño")).unwrap();
        assert_eq!((&renamed.id, renamed.query.text.as_str()), (&a.id, "otoño"));
        // Same filter, other casing: a rename, not a duplicate.
        save(&mut c, draft(Some(&a.id), "ZETA", "otoño")).unwrap();
        delete(&c, &b.id).unwrap();
        assert_eq!(names(&c), ["ZETA"]);
        assert_eq!(delete(&c, &b.id), Err(NotFound(b.id.0.clone())));
        let unknown = SavedFilterId::new();
        assert!(matches!(
            save(&mut c, draft(Some(&unknown), "N", "")),
            Err(NotFound(_))
        ));
        assert!(matches!(
            delete(&c, &SavedFilterId("../x".into())),
            Err(NotFound(_))
        ));
    }

    #[test]
    fn rejects_empty_long_control_and_duplicate_names() {
        let mut c = open_vault(":memory:").unwrap();
        let long = "x".repeat(MAX_FILTER_NAME_CHARS + 1);
        for bad in ["", "   ", "a\u{0007}b", &long] {
            let r = save(&mut c, draft(None, bad, ""));
            assert!(
                matches!(r, Err(SearchError::InvalidFilterName(_))),
                "{bad:?}"
            );
        }
        save(&mut c, draft(None, &"ñ".repeat(MAX_FILTER_NAME_CHARS), "")).unwrap();
        save(&mut c, draft(None, "Campaña", "")).unwrap();
        let dup = save(&mut c, draft(None, " CAMPAÑA ", ""));
        assert_eq!(dup, Err(Dup("CAMPAÑA".into())), "Unicode case-insensitive");
        let other = save(&mut c, draft(None, "Otro", "")).unwrap();
        assert!(matches!(
            save(&mut c, draft(Some(&other.id), "campaña", "")),
            Err(Dup(_))
        ));
        assert_eq!(
            names(&c)[..2],
            ["Campaña", "Otro"],
            "rejected saves write nothing"
        );
    }

    #[test]
    fn validates_hostile_queries_and_clamps_limit() {
        let mut c = open_vault(":memory:").unwrap();
        let with = |f: fn(&mut SearchQuery)| {
            let mut d = draft(None, "Filtro", "");
            f(&mut d.query);
            d
        };
        let bad: [fn(&mut SearchQuery); 7] = [
            |q| q.text = "x".repeat(MAX_FILTER_TEXT_CHARS + 1),
            |q| q.tag = Some("//".into()),
            |q| q.tag = Some(String::new()),
            |q| q.type_key = Some(TypeKey::Builtin(String::new())),
            |q| q.updated_from = Some("ayer".into()),
            |q| {
                q.updated_from = Some("2026-10-02T00:00:00.000Z".into());
                q.updated_to = Some("2026-10-01T00:00:00.000Z".into());
            },
            |q| q.limit = Some(0),
        ];
        for (i, f) in bad.into_iter().enumerate() {
            let r = save(&mut c, with(f));
            assert!(matches!(r, Err(SearchError::InvalidQuery(_))), "case {i}");
        }
        let saved = save(&mut c, with(|q| q.limit = Some(u32::MAX))).unwrap();
        assert_eq!(saved.query.limit, Some(MAX_SEARCH_LIMIT));
        assert_eq!(list(&c).unwrap()[0].query, saved.query);
    }

    #[test]
    fn list_skips_corrupt_rows() {
        let mut c = open_vault(":memory:").unwrap();
        save(&mut c, draft(None, "Sano", "")).unwrap();
        c.execute(
            "INSERT INTO saved_search_filters VALUES ('no-ulid', 'Roto', 'roto', '{}', 1, 1),
             ('01H00000000000000000000001', 'Raro', 'raro', '{\"limit\": \"x\"}', 1, 1)",
            [],
        )
        .unwrap();
        assert_eq!(names(&c), ["Sano"]);
    }
}
