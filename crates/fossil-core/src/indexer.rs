//! Background content indexer (#19): blocks (`blockId`), wikilinks, tags and FTS in one transaction.

use crate::ids::{BlockId, ObjectId};
use crate::object_store::{self, storage_error};
use crate::objects::{CoreError, Link, LinkKind, Mention, OutgoingLink};
use rusqlite::{Connection, Params, params};
use std::collections::{BTreeMap, BTreeSet};
use yrs::types::text::YChange;
use yrs::updates::decoder::Decode;
use yrs::{
    Any, Doc, Out, ReadTxn, Text, Transact, Update, Xml, XmlElementRef, XmlFragment, XmlOut,
    XmlTextRef,
};

const MAX_XML_DEPTH: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IndexedBlock(pub BlockId, pub String, pub i64);

fn exec(conn: &Connection, sql: &str, p: impl Params) -> Result<(), CoreError> {
    conn.prepare_cached(sql)
        .and_then(|mut stmt| stmt.execute(p))
        .map(|_| ())
        .map_err(storage_error)
}

/// Plain text of a Yjs text node: only the inserted strings, never the
/// formatting marks (`get_string` would emit `<bold>…</bold>` and hide tags
/// and wikilinks from the index; same walk as `markdown.rs::inline`).
fn plain_text<T: ReadTxn>(t: &XmlTextRef, txn: &T) -> String {
    t.diff(txn, YChange::identity)
        .into_iter()
        .filter_map(|chunk| match chunk.insert {
            Out::Any(Any::String(s)) => Some(s.to_string()),
            _ => None,
        })
        .collect()
}

fn element_text<T: ReadTxn>(el: &XmlElementRef, txn: &T, depth: usize) -> String {
    if el.tag().as_ref() == "hardBreak" {
        return "\n".into();
    }
    if depth >= MAX_XML_DEPTH {
        return String::new();
    }
    let inline = matches!(el.tag().as_ref(), "paragraph" | "heading" | "codeBlock");
    el.children(txn)
        .filter_map(|c| match c {
            XmlOut::Text(t) => Some(plain_text(&t, txn)),
            XmlOut::Element(sub) => Some(element_text(&sub, txn, depth + 1)),
            XmlOut::Fragment(_) => None,
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(if inline { "" } else { "\n" })
}

fn collect_doc_blocks<T: ReadTxn>(
    object_id: &ObjectId,
    body: &yrs::XmlFragmentRef,
    txn: &T,
) -> Vec<IndexedBlock> {
    body.children(txn)
        .enumerate()
        .filter_map(|(i, node)| {
            let (id, text) = match node {
                XmlOut::Element(el) => {
                    let s = match el.get_attribute(txn, "blockId") {
                        Some(Out::Any(Any::String(s))) => s.to_string(),
                        _ => String::new(),
                    };
                    (
                        (!s.trim().is_empty()).then_some(s),
                        element_text(&el, txn, 0),
                    )
                }
                XmlOut::Text(t) => (None, plain_text(&t, txn)),
                XmlOut::Fragment(_) => return None,
            };
            let bid = BlockId(id.unwrap_or_else(|| format!("{}:{i}", object_id.0)));
            Some(IndexedBlock(bid, text, i as i64))
        })
        .collect()
}

/// Extracts ordered blocks from `Y.XmlFragment("body")` of a lib0 v1 state blob.
pub fn extract_blocks(object_id: &ObjectId, state: &[u8]) -> Result<Vec<IndexedBlock>, CoreError> {
    let doc = Doc::new();
    let body = doc.get_or_insert_xml_fragment("body");
    let mut txn = doc.transact_mut();
    if !state.is_empty() {
        let u = Update::decode_v1(state).map_err(|e| storage_error(format!("corrupt Yjs: {e}")))?;
        txn.apply_update(u)
            .map_err(|e| storage_error(format!("corrupt Yjs: {e}")))?;
    }
    Ok(collect_doc_blocks(object_id, &body, &txn))
}

fn load_blocks(conn: &Connection, id: &ObjectId) -> Result<Vec<IndexedBlock>, CoreError> {
    use rusqlite::OptionalExtension;

    let doc = Doc::new();
    let body = doc.get_or_insert_xml_fragment("body");
    let mut txn = doc.transact_mut();
    let mut apply = |bytes: &[u8]| -> Result<(), CoreError> {
        if !bytes.is_empty() {
            let u =
                Update::decode_v1(bytes).map_err(|e| storage_error(format!("corrupt Yjs: {e}")))?;
            txn.apply_update(u)
                .map_err(|e| storage_error(format!("corrupt Yjs: {e}")))?;
        }
        Ok(())
    };
    if let Some(state) = conn
        .prepare_cached("SELECT state FROM object_snapshots WHERE object_id = ?1")
        .map_err(storage_error)?
        .query_row([&id.0], |r| r.get::<_, Vec<u8>>(0))
        .optional()
        .map_err(storage_error)?
    {
        apply(&state)?;
    }
    let mut stmt = conn
        .prepare_cached("SELECT payload FROM object_updates WHERE object_id = ?1 ORDER BY seq")
        .map_err(storage_error)?;
    for row in stmt
        .query_map([&id.0], |r| r.get::<_, Vec<u8>>(0))
        .map_err(storage_error)?
    {
        apply(&row.map_err(storage_error)?)?;
    }
    Ok(collect_doc_blocks(id, &body, &txn))
}

fn parse_wikilinks(bid: &BlockId, mut s: &str) -> Vec<(BlockId, String, Option<BlockId>)> {
    let mut links = Vec::new();
    while let Some((_, rest)) = s.split_once("[[") {
        let Some((inner, after)) = rest.split_once("]]") else {
            break;
        };
        s = after;
        let head = inner.split('|').next().unwrap_or("").trim();
        let (t, blk) = match head.split_once('#') {
            Some((o, b)) if !b.trim().is_empty() => (o.trim(), Some(BlockId(b.trim().into()))),
            Some((o, _)) => (o.trim(), None),
            None => (head, None),
        };
        if !inner.contains('\n') && !inner.contains("[[") && !t.is_empty() {
            links.push((bid.clone(), t.to_owned(), blk));
        }
    }
    links
}

fn strip_wikilinks(mut s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    while let Some((before, rest)) = s.split_once("[[") {
        let Some((_, after)) = rest.split_once("]]") else {
            return format!("{out}{before}[[{rest}");
        };
        out.push_str(before);
        out.push(' ');
        s = after;
    }
    format!("{out}{s}")
}

fn parse_tags(text: &str) -> Vec<String> {
    if !text.contains('#') {
        return Vec::new();
    }
    let clean = strip_wikilinks(text);
    let mut tags = BTreeSet::new();
    for (idx, _) in clean.match_indices('#') {
        if !clean[..idx]
            .chars()
            .next_back()
            .is_none_or(|c| c.is_whitespace() || "([{\"'.,;:".contains(c))
        {
            continue;
        }
        let raw: String = clean[idx + 1..]
            .chars()
            .take_while(|&c| c.is_alphanumeric() || matches!(c, '_' | '-' | '/'))
            .collect();
        let t = raw.trim_end_matches('/');
        if !t.is_empty()
            && t.split('/').all(|s| !s.is_empty())
            && t.chars().any(char::is_alphabetic)
        {
            tags.insert(t.to_lowercase());
        }
    }
    tags.into_iter().collect()
}

fn resolve_target(conn: &Connection, target: &str) -> Result<String, CoreError> {
    use rusqlite::OptionalExtension;

    let trimmed = target.trim();
    if let Some(id) = conn
        .prepare_cached("SELECT id FROM objects WHERE id = ?1 AND archived = 0 LIMIT 1")
        .map_err(storage_error)?
        .query_row([trimmed], |r| r.get::<_, String>(0))
        .optional()
        .map_err(storage_error)?
    {
        return Ok(id);
    }
    let lower = trimmed.to_lowercase();
    let fts_tokens: Vec<String> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .take(16)
        .map(|w| format!("title : \"{w}\""))
        .collect();
    if !fts_tokens.is_empty() {
        let fts_q = fts_tokens.join(" AND ");
        let mut stmt = conn
            .prepare_cached(
                "SELECT o.id, o.title FROM fts_objects JOIN objects o ON o.id = fts_objects.object_id
                 WHERE fts_objects MATCH ?1 AND o.archived = 0
                 ORDER BY o.created_at ASC, o.id ASC",
            )
            .map_err(storage_error)?;
        let rows = stmt
            .query_map([&fts_q], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(storage_error)?;
        for row in rows {
            let (id, title) = row.map_err(storage_error)?;
            if title.trim().to_lowercase() == lower {
                return Ok(id);
            }
        }
    }
    if let Some(id) = conn
        .prepare_cached(
            "SELECT id FROM objects WHERE archived = 0 AND lower(trim(title)) = ?1
             ORDER BY created_at ASC, id ASC LIMIT 1",
        )
        .map_err(storage_error)?
        .query_row([&lower], |r| r.get::<_, String>(0))
        .optional()
        .map_err(storage_error)?
    {
        return Ok(id);
    }
    if !lower.is_ascii() {
        let char_len = lower.chars().count() as i64;
        let mut stmt = conn
            .prepare_cached(
                "SELECT id, title FROM objects WHERE archived = 0 AND length(trim(title)) = ?1
                 ORDER BY created_at ASC, id ASC",
            )
            .map_err(storage_error)?;
        let rows = stmt
            .query_map([char_len], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(storage_error)?;
        for row in rows {
            let (id, title) = row.map_err(storage_error)?;
            if title.trim().to_lowercase() == lower {
                return Ok(id);
            }
        }
    }
    Ok(lower)
}

fn target_key(conn: &Connection, id: &ObjectId) -> Result<(String, String, bool), CoreError> {
    let m = object_store::get(conn, id)?.ok_or_else(|| CoreError::ObjectNotFound(id.0.clone()))?;
    Ok((m.title.trim().to_lowercase(), m.title, m.archived))
}

/// Re-indexes an object inside one SQLite transaction (`blocks`, `links`, `tags`, `fts_objects`).
pub fn index_object(conn: &mut Connection, id: &ObjectId) -> Result<(), CoreError> {
    let tx = conn.transaction().map_err(storage_error)?;
    let (title_key, title, archived) = target_key(&tx, id)?;
    let blocks = load_blocks(&tx, id)?;
    for sql in [
        "DELETE FROM blocks WHERE object_id = ?1",
        "DELETE FROM links WHERE from_object = ?1",
        "DELETE FROM tags WHERE object_id = ?1",
        "DELETE FROM fts_objects WHERE object_id = ?1",
    ] {
        exec(&tx, sql, [&id.0])?;
    }
    if !archived && !title_key.is_empty() {
        let sql = "UPDATE OR IGNORE links SET to_object = ?1 WHERE to_object = ?2";
        exec(&tx, sql, params![id.0, title_key])?;
    }
    let mut body_parts = Vec::with_capacity(blocks.len());
    let mut seen_in_page: BTreeMap<String, usize> = BTreeMap::new();
    {
        let mut ins_blk = tx
            .prepare_cached(
                "INSERT INTO blocks (id, object_id, text, sort_order) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO NOTHING",
            )
            .map_err(storage_error)?;
        let mut ins_lnk = tx
            .prepare_cached(
                "INSERT OR IGNORE INTO links (from_object, from_block, to_object, to_block, kind) VALUES (?1, ?2, ?3, ?4, 'wikilink')",
            )
            .map_err(storage_error)?;
        let mut ins_tag = tx
            .prepare_cached("INSERT OR IGNORE INTO tags (object_id, tag) VALUES (?1, ?2)")
            .map_err(storage_error)?;

        for IndexedBlock(bid, text, ord) in &blocks {
            body_parts.push(text.as_str());
            let occurrence = seen_in_page.entry(bid.0.clone()).or_insert(0);
            *occurrence += 1;
            let page_local_id = if *occurrence == 1 {
                bid.0.clone()
            } else {
                format!("{}#{occurrence}", bid.0)
            };
            // blocks.id is global: a block pasted from another page keeps its blockId.
            // Never replace another object's row; store this copy under an id scoped
            // to this object instead (this object's rows were deleted above).
            let inserted = ins_blk
                .execute(params![page_local_id, id.0, text, ord])
                .map_err(storage_error)?;
            let bid = if inserted == 1 {
                BlockId(page_local_id)
            } else {
                let mut candidate = format!("{}:{page_local_id}", id.0);
                let mut suffix = 2usize;
                while ins_blk
                    .execute(params![candidate, id.0, text, ord])
                    .map_err(storage_error)?
                    == 0
                {
                    candidate = format!("{}:{page_local_id}#{suffix}", id.0);
                    suffix += 1;
                }
                BlockId(candidate)
            };
            for (fb, tgt, tb) in parse_wikilinks(&bid, text) {
                let to_obj = resolve_target(&tx, &tgt)?;
                ins_lnk
                    .execute(params![id.0, fb.0, to_obj, tb.map(|b| b.0)])
                    .map_err(storage_error)?;
            }
            for tag in parse_tags(text) {
                ins_tag.execute(params![id.0, tag]).map_err(storage_error)?;
            }
        }
    }
    if !archived {
        let sql = "INSERT INTO fts_objects (object_id, title, body) VALUES (?1, ?2, ?3)";
        exec(&tx, sql, params![id.0, title, body_parts.join("\n")])?;
    }
    tx.commit().map_err(storage_error)
}

/// Directed links pointing to `id` from other non-archived objects (a page linking to itself is not a backlink).
pub fn backlinks(conn: &Connection, id: &ObjectId) -> Result<Vec<Link>, CoreError> {
    let (title_key, _, _) = target_key(conn, id)?;
    let mut stmt = conn
        .prepare_cached(
            "SELECT l.from_object, l.from_block, l.to_block, l.kind
             FROM links l JOIN objects o ON o.id = l.from_object
             WHERE o.archived = 0 AND l.from_object != ?1
               AND (l.to_object = ?1 OR (?2 != '' AND l.to_object = ?2))
             ORDER BY o.updated_at DESC, l.from_object, l.from_block",
        )
        .map_err(storage_error)?;
    stmt.query_map(params![id.0, title_key], |r| {
        let kind = match r.get::<_, String>(3)?.as_str() {
            "ref" => LinkKind::Ref,
            "embed" => LinkKind::Embed,
            "tag" => LinkKind::Tag,
            _ => LinkKind::Wikilink,
        };
        Ok(Link {
            from_object: ObjectId(r.get(0)?),
            from_block: r.get::<_, Option<String>>(1)?.map(BlockId),
            to_object: id.clone(),
            to_block: r.get::<_, Option<String>>(2)?.map(BlockId),
            kind,
        })
    })
    .map_err(storage_error)?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(storage_error)
}

/// Links leaving `id` (tags excluded), in index order: resolved ones carry the live
/// target page; unresolved ones keep the text no live page answers to yet.
pub fn outgoing_links(conn: &Connection, id: &ObjectId) -> Result<Vec<OutgoingLink>, CoreError> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT l.from_block, o.id, COALESCE(o.title, l.target_text, l.to_object), l.kind
             FROM links l LEFT JOIN objects o ON o.id = l.to_object AND o.archived = 0
             WHERE l.from_object = ?1 AND l.kind != 'tag'
             ORDER BY l.rowid",
        )
        .map_err(storage_error)?;
    stmt.query_map(params![id.0], |r| {
        let kind = match r.get::<_, String>(3)?.as_str() {
            "ref" => LinkKind::Ref,
            "embed" => LinkKind::Embed,
            _ => LinkKind::Wikilink,
        };
        Ok(OutgoingLink {
            from_block: r.get::<_, Option<String>>(0)?.map(BlockId),
            to_object: r.get::<_, Option<String>>(1)?.map(ObjectId),
            target: r.get(2)?,
            kind,
        })
    })
    .map_err(storage_error)?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(storage_error)
}

/// True when `needle` appears in `text` as whole words: "arte" does not match "parte".
fn contains_words(text: &str, needle: &str) -> bool {
    text.match_indices(needle).any(|(at, m)| {
        let before = text[..at].chars().next_back();
        let after = text[at + m.len()..].chars().next();
        !before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric)
    })
}

/// Non-archived objects whose content mentions `id`'s title, as whole words, in plain text without a link.
pub fn unlinked_mentions(conn: &Connection, id: &ObjectId) -> Result<Vec<Mention>, CoreError> {
    let (needle, _, _) = target_key(conn, id)?;
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let tokens: Vec<String> = needle
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .take(16)
        .map(|w| format!("\"{w}\""))
        .collect();
    let fts_match = (!tokens.is_empty()).then(|| tokens.join(" AND "));
    let sql = if fts_match.is_some() {
        "SELECT b.object_id, b.text FROM blocks b JOIN objects o ON o.id = b.object_id
         WHERE o.archived = 0 AND b.object_id != ?1
           AND b.object_id IN (SELECT object_id FROM fts_objects WHERE fts_objects MATCH ?3)
           AND NOT EXISTS (SELECT 1 FROM links l WHERE l.from_object = b.object_id
             AND (l.to_object = ?1 OR l.to_object = ?2))
         ORDER BY o.updated_at DESC, b.object_id, b.sort_order"
    } else {
        "SELECT b.object_id, b.text FROM blocks b JOIN objects o ON o.id = b.object_id
         WHERE o.archived = 0 AND b.object_id != ?1 AND (?3 IS NULL)
           AND NOT EXISTS (SELECT 1 FROM links l WHERE l.from_object = b.object_id
             AND (l.to_object = ?1 OR l.to_object = ?2))
         ORDER BY o.updated_at DESC, b.object_id, b.sort_order"
    };
    let mut stmt = conn.prepare_cached(sql).map_err(storage_error)?;
    let mut rows = stmt
        .query(params![id.0, needle, fts_match])
        .map_err(storage_error)?;
    let (mut seen, mut mentions) = (BTreeSet::new(), Vec::new());
    while let Some(row) = rows.next().map_err(storage_error)? {
        let oid: String = row.get(0).map_err(storage_error)?;
        if seen.contains(&oid) {
            continue;
        }
        let snippet: String = row.get(1).map_err(storage_error)?;
        if contains_words(&strip_wikilinks(&snippet).to_lowercase(), &needle) {
            seen.insert(oid.clone());
            mentions.push(Mention {
                object_id: ObjectId(oid),
                snippet,
            });
        }
    }
    Ok(mentions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc_store;
    use crate::objects::{NewObject, TypeKey};
    use crate::storage::open_vault;
    use yrs::{StateVector, XmlElementPrelim, XmlTextPrelim};

    fn page(c: &Connection, t: &str) -> ObjectId {
        let m = NewObject {
            types: vec![TypeKey::Page],
            title: t.into(),
            icon: None,
            parent: None,
        };
        object_store::create(c, m).unwrap().id
    }

    fn set_body(conn: &mut Connection, id: &ObjectId, blocks: &[(&str, &str, &str)]) {
        let sql = "DELETE FROM object_updates WHERE object_id = ?1";
        exec(conn, sql, [&id.0]).unwrap();
        let doc = Doc::new();
        let body = doc.get_or_insert_xml_fragment("body");
        {
            let mut txn = doc.transact_mut();
            for (tag, bid, text) in blocks {
                let el = body.push_back(&mut txn, XmlElementPrelim::empty(*tag));
                el.insert_attribute(&mut txn, "blockId", Any::from(*bid));
                el.push_back(&mut txn, XmlTextPrelim::new(*text));
            }
        }
        let u = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        doc_store::apply_update(conn, id, &u).unwrap();
        index_object(conn, id).unwrap();
    }

    fn count(conn: &Connection, id: &ObjectId) -> i64 {
        let sql = "SELECT COUNT(*) FROM blocks WHERE object_id = ?1";
        conn.query_row(sql, [&id.0], |r| r.get(0)).unwrap()
    }

    fn scalar(conn: &Connection, sql: &str, p: &str) -> String {
        conn.query_row(sql, [p], |r| r.get(0)).unwrap()
    }

    #[test]
    fn indexes_blocks_wikilinks_tags_fts_and_unlinked_mentions() {
        let mut conn = open_vault(":memory:").unwrap();
        let (by_title, by_id) = (
            page(&conn, "Árbol Trimestral"),
            page(&conn, "Presupuesto Anual"),
        );
        let (src, note) = (
            page(&conn, "Notas de coordinación"),
            page(&conn, "Bitácora"),
        );
        let p2 = format!(
            "Ver [[árbol trimestral]] y [[{}#sec-1|Presupuesto]] con #operaciones https://x.co#ignorar",
            by_id.0
        );
        let b1 = ("heading", "blk-1", "Resumen #estrategia/anual");
        set_body(&mut conn, &src, &[b1, ("paragraph", "blk-2", &p2)]);
        set_body(
            &mut conn,
            &note,
            &[("paragraph", "b1", "Ver árbol trimestral")],
        );

        let blk_q = "SELECT group_concat(id || ':' || sort_order) FROM blocks WHERE object_id = ?1";
        assert_eq!(scalar(&conn, blk_q, &src.0), "blk-1:0,blk-2:1");
        let tag_q = "SELECT group_concat(tag) FROM (SELECT tag FROM tags WHERE object_id = ?1 ORDER BY tag)";
        assert_eq!(scalar(&conn, tag_q, &src.0), "estrategia/anual,operaciones");

        let l_title = backlinks(&conn, &by_title).unwrap();
        assert_eq!((l_title.len(), &l_title[0].from_object), (1, &src));
        assert_eq!(l_title[0].from_block, Some(BlockId("blk-2".into())));
        let l_id = backlinks(&conn, &by_id).unwrap();
        assert_eq!(l_id[0].to_block, Some(BlockId("sec-1".into())));

        let mentions = unlinked_mentions(&conn, &by_title).unwrap();
        assert_eq!((mentions.len(), &mentions[0].object_id), (1, &note));

        let fts_q = "SELECT CAST(COUNT(*) AS TEXT) FROM fts_objects WHERE fts_objects MATCH ?1";
        assert_eq!(scalar(&conn, fts_q, "coordinación AND Resumen"), "1");

        set_body(&mut conn, &src, &[("paragraph", "blk-2", "Texto #nuevo")]);
        assert!(backlinks(&conn, &by_title).unwrap().is_empty());
    }

    #[test]
    fn formatting_marks_never_reach_the_index() {
        let mut conn = open_vault(":memory:").unwrap();
        let id = page(&conn, "Marcas");
        let doc = Doc::new();
        let body = doc.get_or_insert_xml_fragment("body");
        {
            let mut txn = doc.transact_mut();
            let el = body.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
            el.insert_attribute(&mut txn, "blockId", Any::from("blk-m"));
            let text = el.push_back(&mut txn, XmlTextPrelim::new("nota "));
            let bold: yrs::types::Attrs = [(std::sync::Arc::from("bold"), Any::Bool(true))].into();
            text.insert_with_attributes(&mut txn, 5, "#urgente", bold);
        }
        let u = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        doc_store::apply_update(&mut conn, &id, &u).unwrap();
        index_object(&mut conn, &id).unwrap();
        let text = scalar(&conn, "SELECT text FROM blocks WHERE object_id = ?1", &id.0);
        assert_eq!(text, "nota #urgente", "no <bold> tags in the indexed text");
        let tag = scalar(&conn, "SELECT tag FROM tags WHERE object_id = ?1", &id.0);
        assert_eq!(tag, "urgente");
    }

    #[test]
    fn a_block_id_shared_with_another_page_never_deletes_its_row() {
        let mut conn = open_vault(":memory:").unwrap();
        let (a, b) = (page(&conn, "Origen"), page(&conn, "Copia"));
        set_body(&mut conn, &a, &[("paragraph", "same", "Texto de A")]);
        set_body(&mut conn, &b, &[("paragraph", "same", "Texto de B")]);
        assert_eq!(
            (count(&conn, &a), count(&conn, &b)),
            (1, 1),
            "pasting a block keeps both rows"
        );
        let a_text = scalar(&conn, "SELECT text FROM blocks WHERE id = ?1", "same");
        assert_eq!(a_text, "Texto de A");
        set_body(
            &mut conn,
            &b,
            &[("paragraph", "same", "Texto de B, editado")],
        );
        assert_eq!(
            (count(&conn, &a), count(&conn, &b)),
            (1, 1),
            "re-indexing the copy stays scoped"
        );
    }

    #[test]
    fn archived_object_does_not_claim_unresolved_incoming_links_and_duplicate_block_ids_survive() {
        let mut conn = open_vault(":memory:").unwrap();
        let src = page(&conn, "Origen");
        set_body(
            &mut conn,
            &src,
            &[
                ("paragraph", "dup", "Ver [[Objetivo]] uno"),
                ("paragraph", "dup", "Ver [[Objetivo]] dos"),
            ],
        );
        assert_eq!(count(&conn, &src), 2);
        let blk_ids = scalar(
            &conn,
            "SELECT group_concat(id, ',') FROM (SELECT id FROM blocks WHERE object_id = ?1 ORDER BY sort_order)",
            &src.0,
        );
        assert_eq!(blk_ids, "dup,dup#2");

        let target = page(&conn, "Objetivo");
        object_store::archive(&mut conn, &target).unwrap();
        index_object(&mut conn, &target).unwrap();
        let resolved = scalar(
            &conn,
            "SELECT to_object FROM links WHERE from_object = ?1 LIMIT 1",
            &src.0,
        );
        assert_eq!(resolved, "objetivo");
    }

    #[test]
    fn mentions_match_whole_words_and_self_links_are_not_backlinks() {
        let mut conn = open_vault(":memory:").unwrap();
        let (arte, other) = (page(&conn, "Arte"), page(&conn, "Otra"));
        set_body(
            &mut conn,
            &other,
            &[("paragraph", "o1", "Una parte del plan")],
        );
        assert!(
            unlinked_mentions(&conn, &arte).unwrap().is_empty(),
            "arte is not parte"
        );
        set_body(
            &mut conn,
            &other,
            &[("paragraph", "o1", "Hablamos de arte, mucho.")],
        );
        assert_eq!(unlinked_mentions(&conn, &arte).unwrap().len(), 1);
        set_body(
            &mut conn,
            &arte,
            &[("paragraph", "a1", "Ver [[Arte]] y [[Otra]]")],
        );
        assert!(
            backlinks(&conn, &arte).unwrap().is_empty(),
            "a self-link is not a backlink"
        );
        assert_eq!(backlinks(&conn, &other).unwrap().len(), 1);
    }

    #[test]
    fn outgoing_links_list_resolved_and_unresolved_targets_without_tags() {
        let mut conn = open_vault(":memory:").unwrap();
        let (src, plan) = (page(&conn, "Origen"), page(&conn, "Plan Acme"));
        set_body(
            &mut conn,
            &src,
            &[(
                "paragraph",
                "p1",
                "Ver [[Plan Acme]], [[Idea suelta]] y #urgente",
            )],
        );
        let out = outgoing_links(&conn, &src).unwrap();
        assert_eq!(out.len(), 2, "tags are not outgoing links: {out:?}");
        assert_eq!(out[0].to_object.as_ref(), Some(&plan));
        assert_eq!(out[0].target, "Plan Acme");
        assert_eq!(out[1].to_object, None);
        assert_eq!(out[1].target.to_lowercase(), "idea suelta");
        object_store::archive(&mut conn, &plan).unwrap();
        index_object(&mut conn, &src).unwrap();
        assert_eq!(
            outgoing_links(&conn, &src).unwrap()[0].to_object,
            None,
            "an archived target is unresolved"
        );
    }

    #[test]
    fn id_form_wikilinks_resolve_by_id_whatever_the_alias_says() {
        // Contract #128: `[[<id>|Título]]` and `[[<id>#<blockId>|Título]]` pin the target.
        let mut conn = open_vault(":memory:").unwrap();
        let (older, newer) = (page(&conn, "Plan Acme"), page(&conn, "Plan Acme"));
        // Same-millisecond Ulids are not ordered: pin which one is the oldest.
        exec(
            &conn,
            "UPDATE objects SET created_at = 0 WHERE id = ?1",
            [&older.0],
        )
        .unwrap();
        let src = page(&conn, "Origen");
        let text = format!("[[Plan Acme]] y [[{}|Plan Acme]]", newer.0);
        set_body(&mut conn, &src, &[("paragraph", "p1", &text)]);
        let anchored = format!("[[{}#blk-9|Otro alias]]", newer.0);
        let src2 = page(&conn, "Origen 2");
        set_body(&mut conn, &src2, &[("paragraph", "p2", &anchored)]);
        assert_eq!(
            backlinks(&conn, &older).unwrap().len(),
            1,
            "title form: oldest"
        );
        let to_newer = backlinks(&conn, &newer).unwrap();
        assert_eq!(to_newer.len(), 2, "id form: exact object, alias ignored");
        assert!(
            to_newer
                .iter()
                .any(|l| l.to_block == Some(BlockId("blk-9".into())))
        );
    }

    #[test]
    fn contains_words_respects_unicode_boundaries() {
        assert!(contains_words("ver árbol trimestral", "árbol trimestral"));
        assert!(!contains_words("subárbol", "árbol"));
        assert!(contains_words("(árbol)", "árbol"));
    }

    #[test]
    fn fast_wikilink_resolution_and_fts_prefiltered_mentions() {
        let mut conn = open_vault(":memory:").unwrap();
        let (target, sym, multi) = (
            page(&conn, "Objetivo Único"),
            page(&conn, "+++"),
            page(&conn, "Menciones Múltiples"),
        );
        set_body(
            &mut conn,
            &multi,
            &[
                ("paragraph", "m1", "Primer bloque con objetivo único aquí"),
                ("paragraph", "m2", "Segundo bloque con objetivo único allá"),
                ("paragraph", "m3", "Bloque con símbolo +++ suelto"),
            ],
        );
        let mentions = unlinked_mentions(&conn, &target).unwrap();
        assert_eq!(
            (
                mentions.len(),
                &mentions[0].object_id,
                mentions[0].snippet.as_str()
            ),
            (1, &multi, "Primer bloque con objetivo único aquí")
        );
        assert_eq!(unlinked_mentions(&conn, &sym).unwrap()[0].object_id, multi);

        let wl_page = page(&conn, "Índice de enlaces");
        let links: String = (0..40)
            .map(|i| format!("[[Objetivo Único]] [[No existe {i}]]"))
            .collect::<Vec<_>>()
            .join(" ");
        set_body(&mut conn, &wl_page, &[("paragraph", "wl-1", &links)]);
        assert_eq!(backlinks(&conn, &target).unwrap().len(), 1);
    }
}
