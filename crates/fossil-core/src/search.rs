//! Full-text search contract (issue #92, spec `docs/specs/r1-search.md`).
//!
//! Wire types shared by storage, IPC (`search_query`) and the frontend, plus
//! the FTS5 query engine and operator parser (#20).

use chrono::DateTime;
use rusqlite::{Connection, params};
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

impl From<rusqlite::Error> for SearchError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Storage(e.to_string())
    }
}

/// Parsed representation of inline search operators (`docs/modules/search.md`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ParsedQuery {
    pub positive: Vec<String>,
    pub negative: Vec<String>,
    pub tags: Vec<String>,
    pub types: Vec<TypeKey>,
}

fn clean_tag(raw: &str) -> Option<String> {
    let t = raw.trim().trim_start_matches('#').trim_end_matches('/');
    (!t.is_empty() && t.split('/').all(|s| !s.is_empty())).then(|| t.to_lowercase())
}

fn part(text: impl Into<String>, matched: bool) -> SnippetPart {
    SnippetPart {
        text: text.into(),
        matched,
    }
}

/// Splits an FTS5 `snippet(..., char(1), char(2), ...)` string into structured [`SnippetPart`]s.
pub fn parse_snippet(raw: &str) -> Vec<SnippetPart> {
    let (mut parts, mut segs) = (Vec::new(), raw.split('\u{0001}'));
    if let Some(first) = segs.next().filter(|s| !s.is_empty()) {
        parts.push(part(first, false));
    }
    for seg in segs {
        let (hit, tail) = seg.split_once('\u{0002}').unwrap_or((seg, ""));
        if !hit.is_empty() {
            parts.push(part(hit, true));
        }
        if !tail.is_empty() {
            parts.push(part(tail, false));
        }
    }
    parts
}

/// Parses inline operators (`"phrase"`, `-exclude`, `-"phrase"`, `tag:x`, `type:journal`).
pub fn parse_search_text(input: &str) -> ParsedQuery {
    let (mut out, mut rest) = (ParsedQuery::default(), input.trim_start());
    while !rest.is_empty() {
        let q = rest
            .strip_prefix("-\"")
            .map(|s| (true, s))
            .or_else(|| rest.strip_prefix('"').map(|s| (false, s)));
        if let Some((neg, s)) = q {
            let (p, tail) = s.split_once('"').unwrap_or((s, ""));
            if !p.trim().is_empty() {
                [&mut out.positive, &mut out.negative][usize::from(neg)].push(p.trim().to_owned());
            }
            rest = tail.trim_start();
            continue;
        }
        let end = rest
            .find(|c: char| c.is_whitespace() || c == '"')
            .unwrap_or(rest.len());
        let (tok, low) = (&rest[..end], rest[..end].to_ascii_lowercase());
        rest = rest[end..].trim_start();
        if low.starts_with("tag:") {
            out.tags.extend(clean_tag(&tok[4..]));
        } else if let Some(v) = low.strip_prefix("type:") {
            match v.trim() {
                "" => {}
                "page" => out.types.push(TypeKey::Page),
                "journal" => out.types.push(TypeKey::Journal),
                other => out.types.push(TypeKey::Builtin(other.to_owned())),
            }
        } else if let Some(neg) = tok.strip_prefix('-') {
            if !neg.trim().is_empty() {
                out.negative.push(neg.trim().to_owned());
            }
        } else if !tok.is_empty() {
            out.positive.push(tok.to_owned());
        }
    }
    out
}

fn fts_phrase(term: impl AsRef<str>) -> Option<String> {
    let s = term.as_ref();
    s.chars()
        .any(char::is_alphanumeric)
        .then(|| format!("\"{}\"", s.replace('"', "\"\"")))
}

fn parse_iso_ms(raw: &Option<String>) -> Result<Option<i64>, SearchError> {
    let Some(s) = raw.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    DateTime::parse_from_rfc3339(s)
        .map(|dt| Some(dt.timestamp_millis()))
        .map_err(|e| SearchError::InvalidQuery(format!("invalid timestamp '{s}': {e}")))
}

macro_rules! fts_sql {
    ($clauses:expr) => {
        concat!(
            "SELECT o.id, o.title, snippet(fts_objects, -1, char(1), char(2), '…', 16), -bm25(fts_objects, 0.0, 10.0, 1.0)
             FROM fts_objects JOIN objects o ON o.id = fts_objects.object_id WHERE fts_objects MATCH ?1",
            $clauses,
            "ORDER BY bm25(fts_objects, 0.0, 10.0, 1.0) ASC, o.updated_at DESC, o.id ASC LIMIT ?6"
        )
    };
}

macro_rules! scan_sql {
    ($clauses:expr) => {
        concat!(
            "SELECT o.id, o.title, COALESCE((SELECT b.text FROM blocks b WHERE b.object_id = o.id ORDER BY b.sort_order ASC LIMIT 1), ''), 0.0
             FROM objects o WHERE (?1 IS NULL OR o.id NOT IN (SELECT object_id FROM fts_objects WHERE fts_objects MATCH ?1))",
            $clauses,
            "ORDER BY o.updated_at DESC, o.id ASC LIMIT ?6"
        )
    };
}

macro_rules! clauses_single {
    () => {
        " AND o.archived = 0
          AND (?2 IS NULL OR instr(o.types, ?2) > 0)
          AND (?3 IS NULL OR EXISTS (SELECT 1 FROM tags t WHERE t.object_id = o.id
            AND (+t.tag = ?3 OR (+t.tag >= ?3 || '/' AND +t.tag < ?3 || '0'))))
          AND (?4 IS NULL OR o.updated_at >= ?4) AND (?5 IS NULL OR o.updated_at <= ?5) "
    };
}

macro_rules! clauses_multi {
    () => {
        " AND o.archived = 0
          AND (?2 IS NULL OR NOT EXISTS (SELECT 1 FROM json_each(?2) r WHERE instr(o.types, r.value) = 0))
          AND (?3 IS NULL OR NOT EXISTS (SELECT 1 FROM json_each(?3) r WHERE NOT EXISTS (
            SELECT 1 FROM tags t WHERE t.object_id = o.id
              AND (+t.tag = r.value OR (+t.tag >= r.value || '/' AND +t.tag < r.value || '0')))))
          AND (?4 IS NULL OR o.updated_at >= ?4) AND (?5 IS NULL OR o.updated_at <= ?5) "
    };
}

/// Executes a [`SearchQuery`] against the vault SQLite connection (#20).
pub fn search_query(conn: &Connection, query: &SearchQuery) -> Result<Vec<SearchHit>, SearchError> {
    let limit = match query.limit {
        Some(0) => return Ok(Vec::new()),
        Some(n) => i64::from(n.min(MAX_SEARCH_LIMIT)),
        None => i64::from(DEFAULT_SEARCH_LIMIT),
    };
    let (from_ms, to_ms) = (
        parse_iso_ms(&query.updated_from)?,
        parse_iso_ms(&query.updated_to)?,
    );
    let mut p = parse_search_text(&query.text);
    if let Some(tk) = &query.type_key
        && !p.types.contains(tk)
    {
        p.types.push(tk.clone());
    }
    if let Some(t) = query.tag.as_deref().and_then(clean_tag)
        && !p.tags.contains(&t)
    {
        p.tags.push(t);
    }
    let single = p.types.len() <= 1 && p.tags.len() <= 1;
    let types_arg = if single {
        p.types.first().and_then(|t| serde_json::to_string(t).ok())
    } else {
        (!p.types.is_empty())
            .then(|| {
                let v: Vec<_> = p
                    .types
                    .iter()
                    .filter_map(|t| serde_json::to_string(t).ok())
                    .collect();
                serde_json::to_string(&v).ok()
            })
            .flatten()
    };
    let tags_arg = if single {
        p.tags.first().cloned()
    } else {
        (!p.tags.is_empty())
            .then(|| serde_json::to_string(&p.tags).ok())
            .flatten()
    };

    let pos: Vec<_> = p.positive.iter().filter_map(fts_phrase).collect();
    let neg: Vec<_> = p.negative.iter().filter_map(fts_phrase).collect();
    let (fts_arg, sql) = if !pos.is_empty() {
        let mut fts = pos.join(" AND ");
        for n in &neg {
            fts.push_str(&format!(" NOT {n}"));
        }
        let s = [fts_sql!(clauses_multi!()), fts_sql!(clauses_single!())][usize::from(single)];
        (Some(fts), s)
    } else {
        let s = [scan_sql!(clauses_multi!()), scan_sql!(clauses_single!())][usize::from(single)];
        ((!neg.is_empty()).then(|| neg.join(" OR ")), s)
    };

    let args = params![fts_arg, types_arg, tags_arg, from_ms, to_ms, limit];
    conn.prepare_cached(sql)?
        .query_map(args, |r| {
            Ok(SearchHit {
                object_id: ObjectId(r.get(0)?),
                title: r.get(1)?,
                snippet: parse_snippet(&r.get::<_, String>(2)?),
                score: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, SearchError, SearchHit, SearchQuery, SnippetPart,
        parse_search_text, search_query,
    };
    use crate::ids::ObjectId;
    use crate::objects::{CoreError, NewObject, TypeKey};
    use crate::storage::open_vault;
    use crate::{doc_store, indexer, object_store};
    use rusqlite::Connection;
    use yrs::{Doc, ReadTxn, StateVector, Transact, XmlElementPrelim, XmlFragment, XmlTextPrelim};

    fn add_doc(c: &mut Connection, ty: TypeKey, title: &str, text: &str) -> ObjectId {
        let (types, title) = (vec![ty], title.into());
        let m = NewObject {
            types,
            title,
            icon: None,
            parent: None,
        };
        let (id, doc) = (object_store::create(c, m).unwrap().id, Doc::new());
        let body = doc.get_or_insert_xml_fragment("body");
        let mut txn = doc.transact_mut();
        let el = body.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
        el.push_back(&mut txn, XmlTextPrelim::new(text));
        drop(txn);
        let u = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        doc_store::apply_update(c, &id, &u).unwrap();
        indexer::index_object(c, &id).unwrap();
        id
    }

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

    #[test]
    fn parser_and_search_weight_titles_fold_diacritics_and_apply_operators() {
        let p = parse_search_text(
            "\"campaña anual\" -borrador -\"fase 0\" tag:#Estrategia/Q4 type:journal - tag: type: \"abierta",
        );
        assert_eq!(p.positive, ["campaña anual", "abierta"]);
        assert_eq!(p.negative, ["borrador", "fase 0"]);
        assert_eq!(p.tags, ["estrategia/q4"]);
        assert_eq!(p.types, [TypeKey::Journal]);

        let mut c = open_vault(":memory:").unwrap();
        let b_id = add_doc(
            &mut c,
            TypeKey::Page,
            "Notas",
            "Campaña de otoño #estrategia/q4",
        );
        let t_id = add_doc(
            &mut c,
            TypeKey::Page,
            "Campaña de otoño",
            "Nota #estrategia/q4",
        );
        let j_id = add_doc(
            &mut c,
            TypeKey::Journal,
            "Campaña borrador",
            "#estrategia/q4",
        );
        let q = |s: &str| SearchQuery {
            text: s.into(),
            ..Default::default()
        };

        let hits = search_query(&c, &q("\"campana de otono\" -borrador tag:estrategia")).unwrap();
        assert_eq!(
            hits.iter().map(|h| &h.object_id).collect::<Vec<_>>(),
            vec![&t_id, &b_id]
        );
        assert!(hits[0].score > hits[1].score && hits[0].snippet.iter().any(|s| s.matched));
        let mut j_q = q("campana type:journal");
        assert_eq!(search_query(&c, &j_q).unwrap()[0].object_id, j_id);
        j_q.updated_from = Some("bad".into());
        assert!(matches!(
            search_query(&c, &j_q),
            Err(SearchError::InvalidQuery(_))
        ));
    }
}
