//! Quick capture (#28): appends plain text to today's journal or to a chosen
//! object without opening the main window. Each non-empty line becomes a
//! paragraph with its own `blockId` (ADR-0005), the same shape the editor
//! writes, so captured blocks are indexed, linked and mirrored like any other.
use crate::doc_store;
use crate::ids::ObjectId;
use crate::journal;
use crate::object_store::{self, storage_error};
use crate::objects::{CoreError, ObjectMeta};
use rusqlite::Connection;
use yrs::types::xml::XmlOut;
use yrs::updates::decoder::Decode;
use yrs::{
    Doc, GetString, ReadTxn, Transact, Update, Xml, XmlElementPrelim, XmlFragment, XmlTextPrelim,
};

/// Upper bound per capture: the input is a quick note, not a document import.
pub const MAX_CAPTURE_CHARS: usize = 20_000;

/// Appends `text` to `target` (or to today's journal, created if needed) and
/// returns the updated object. Rejects empty and oversized input before
/// touching the vault.
pub fn append(
    conn: &mut Connection,
    target: Option<&ObjectId>,
    text: &str,
) -> Result<ObjectMeta, CoreError> {
    if text.chars().count() > MAX_CAPTURE_CHARS {
        return Err(storage_error("capture text is too long"));
    }
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect();
    if lines.is_empty() {
        return Err(storage_error("capture text is empty"));
    }
    let id = match target {
        Some(id) => {
            object_store::get(conn, id)?.ok_or_else(|| CoreError::ObjectNotFound(id.0.clone()))?;
            id.clone()
        }
        None => journal::today(conn)?.0.id,
    };

    let doc = Doc::new();
    let body = doc.get_or_insert_xml_fragment("body");
    let state = doc_store::load(conn, &id)?;
    if !state.is_empty() {
        let update =
            Update::decode_v1(&state).map_err(|e| storage_error(format!("corrupt Yjs: {e}")))?;
        doc.transact_mut()
            .apply_update(update)
            .map_err(|e| storage_error(format!("corrupt Yjs: {e}")))?;
    }
    let before = doc.transact().state_vector();
    {
        let mut txn = doc.transact_mut();
        // A fresh journal holds one empty paragraph (its template): replace it.
        if body.len(&txn) == 1
            && let Some(XmlOut::Element(only)) = body.get(&txn, 0)
            && only.tag().as_ref() == "paragraph"
            && only.get_string(&txn).is_empty()
        {
            body.remove_range(&mut txn, 0, 1);
        }
        for line in lines {
            let paragraph = body.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
            paragraph.insert_attribute(&mut txn, "blockId", ulid::Ulid::generate().to_string());
            paragraph.push_back(&mut txn, XmlTextPrelim::new(line));
        }
    }
    let update = doc.transact().encode_state_as_update_v1(&before);
    doc_store::apply_update(conn, &id, &update)?;
    object_store::get(conn, &id)?.ok_or_else(|| CoreError::ObjectNotFound(id.0.clone()))
}

#[cfg(test)]
mod tests {
    use super::{MAX_CAPTURE_CHARS, append};
    use crate::objects::{CoreError, NewObject, TypeKey};
    use crate::{indexer, journal, object_store, storage::open_vault};

    fn texts(conn: &mut rusqlite::Connection, id: &crate::ids::ObjectId) -> Vec<String> {
        let state = crate::doc_store::load(conn, id).unwrap();
        indexer::extract_blocks(id, &state)
            .unwrap()
            .into_iter()
            .map(|block| block.1)
            .collect()
    }

    #[test]
    fn appends_lines_to_todays_journal_replacing_its_empty_template() {
        let mut conn = open_vault(":memory:").unwrap();
        let meta = append(&mut conn, None, "Llamar a Acme\n\n  Revisar el brief  \n").unwrap();
        let (today, created) = journal::today(&mut conn).unwrap();
        assert_eq!((meta.id.clone(), created), (today.id, false));
        assert_eq!(texts(&mut conn, &meta.id), ["Llamar a Acme", "  Revisar el brief"]);

        append(&mut conn, None, "Tercera nota").unwrap();
        assert_eq!(texts(&mut conn, &meta.id).len(), 3, "later captures append");
    }

    #[test]
    fn appends_to_a_chosen_object_and_rejects_bad_input() {
        let mut conn = open_vault(":memory:").unwrap();
        let page = object_store::create(
            &conn,
            NewObject {
                types: vec![TypeKey::Page],
                title: "Ideas".into(),
                icon: None,
                parent: None,
            },
        )
        .unwrap();
        append(&mut conn, Some(&page.id), "Una idea").unwrap();
        assert_eq!(texts(&mut conn, &page.id), ["Una idea"]);

        assert!(append(&mut conn, Some(&page.id), " \n\t\n").is_err());
        let huge = "a".repeat(MAX_CAPTURE_CHARS + 1);
        assert!(append(&mut conn, Some(&page.id), &huge).is_err());
        let missing = crate::ids::ObjectId::new();
        assert!(matches!(
            append(&mut conn, Some(&missing), "x"),
            Err(CoreError::ObjectNotFound(_))
        ));
        assert_eq!(texts(&mut conn, &page.id), ["Una idea"], "rejections write nothing");
    }
}
