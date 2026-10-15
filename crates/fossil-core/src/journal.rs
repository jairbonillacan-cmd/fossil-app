//! Daily journal (#22): one `Journal` object per local day, titled with the
//! ISO date (`YYYY-MM-DD`, locale-free; the UI formats it for display).
use crate::doc_store::{COMPACT_AFTER_UPDATES, append_in};
use crate::ids::ObjectId;
use crate::object_store::{self, storage_error};
use crate::objects::{CoreError, NewObject, ObjectMeta, TypeKey};
use chrono::{Local, NaiveDate};
use rusqlite::{Connection, OptionalExtension, params};
use yrs::{Doc, Transact, XmlElementPrelim, XmlFragment};

/// Initial Yjs content of a new journal: one empty paragraph in `body`, the
/// shape y-prosemirror/TipTap expect for an empty document.
fn template() -> Vec<u8> {
    let doc = Doc::new();
    let body = doc.get_or_insert_xml_fragment("body");
    let mut txn = doc.transact_mut();
    body.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
    txn.encode_update_v1()
}

/// Today's journal (local time). Returns the object and whether it was created.
pub fn today(conn: &mut Connection) -> Result<(ObjectMeta, bool), CoreError> {
    for_date(conn, Local::now().date_naive())
}

/// Idempotent: reuses the journal of `date` (restoring it if it was archived)
/// or creates it with the template, all in one transaction.
pub fn for_date(conn: &mut Connection, date: NaiveDate) -> Result<(ObjectMeta, bool), CoreError> {
    let title = date.format("%Y-%m-%d").to_string();
    let tx = conn.transaction().map_err(storage_error)?;
    let existing: Option<(String, bool)> = tx
        .query_row(
            "SELECT id, archived FROM objects
             WHERE title=?1 AND EXISTS (SELECT 1 FROM json_each(objects.types) WHERE value='Journal')
             ORDER BY archived, created_at LIMIT 1",
            [&title],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(storage_error)?;
    let (id, created) = match existing {
        Some((id, archived)) => {
            if archived {
                tx.execute("UPDATE objects SET archived=0 WHERE id=?1", params![id])
                    .map_err(storage_error)?;
            }
            (ObjectId(id), archived)
        }
        None => {
            let meta = object_store::create(
                &tx,
                NewObject {
                    types: vec![TypeKey::Journal],
                    title,
                    icon: None,
                    parent: None,
                },
            )?;
            append_in(&tx, &meta.id, &template(), COMPACT_AFTER_UPDATES)?;
            (meta.id, true)
        }
    };
    let meta =
        object_store::get(&tx, &id)?.ok_or_else(|| CoreError::ObjectNotFound(id.0.clone()))?;
    tx.commit().map_err(storage_error)?;
    Ok((meta, created))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc_store;
    use crate::objects::ObjectFilter;
    use crate::storage::open_vault;
    use yrs::updates::decoder::Decode;
    use yrs::{GetString, Update};

    fn date(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, d).unwrap()
    }

    #[test]
    fn same_day_is_idempotent_and_new_day_creates_another() {
        let mut conn = open_vault(":memory:").unwrap();
        let (first, created) = for_date(&mut conn, date(14)).unwrap();
        assert!(created);
        assert_eq!(first.title, "2026-10-14");
        assert_eq!(first.types, vec![TypeKey::Journal]);
        let (again, created) = for_date(&mut conn, date(14)).unwrap();
        assert!(!created);
        assert_eq!(again.id, first.id);
        let (next, created) = for_date(&mut conn, date(15)).unwrap();
        assert!(created);
        assert_ne!(next.id, first.id);
        assert_eq!(
            object_store::list(&conn, ObjectFilter::default())
                .unwrap()
                .len(),
            2
        );
        // The template is stored once, not on every call.
        let updates: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM object_updates WHERE object_id=?1",
                [&first.id.0],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(updates, 1);
    }

    #[test]
    fn new_journal_has_the_template_and_pages_with_the_same_title_are_ignored() {
        let mut conn = open_vault(":memory:").unwrap();
        let page = object_store::create(
            &conn,
            NewObject {
                types: vec![TypeKey::Page],
                title: "2026-10-14".into(),
                icon: None,
                parent: None,
            },
        )
        .unwrap();
        let (journal, created) = for_date(&mut conn, date(14)).unwrap();
        assert!(created);
        assert_ne!(journal.id, page.id);
        let state = doc_store::load(&conn, &journal.id).unwrap();
        let doc = Doc::new();
        let body = doc.get_or_insert_xml_fragment("body");
        let mut txn = doc.transact_mut();
        txn.apply_update(Update::decode_v1(&state).unwrap())
            .unwrap();
        assert_eq!(body.len(&txn), 1);
        assert_eq!(body.get_string(&txn), "<paragraph></paragraph>");
    }

    #[test]
    fn archived_journal_of_the_day_is_restored_not_duplicated() {
        let mut conn = open_vault(":memory:").unwrap();
        let (journal, _) = for_date(&mut conn, date(14)).unwrap();
        object_store::archive(&mut conn, &journal.id).unwrap();
        let (restored, created) = for_date(&mut conn, date(14)).unwrap();
        assert!(
            created,
            "restoring an archived journal marks it changed for FTS/mirror"
        );
        assert_eq!(restored.id, journal.id);
        assert!(!restored.archived);
    }
}
