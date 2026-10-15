//! Markdown mirror rendering (#21, ADR-0004): export only. Turns an object's
//! Yjs `body` (TipTap / y-prosemirror node names) into Markdown that common
//! Markdown editors can read, with YAML frontmatter, and computes Windows-safe
//! vault paths.
use crate::ids::ObjectId;
use crate::object_store::{self, storage_error};
use crate::objects::{CoreError, ObjectMeta, TypeKey};
use rusqlite::{Connection, params};
use std::path::PathBuf;
use yrs::types::text::YChange;
use yrs::updates::decoder::Decode;
use yrs::{
    Any, Doc, Out, ReadTxn, Text, Transact, Update, Xml, XmlElementRef, XmlFragment, XmlOut,
    XmlTextRef,
};

/// Device names Windows refuses as file names, with or without extension.
const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];
const MAX_NAME_CHARS: usize = 120;
const MAX_DEPTH: usize = 32;

#[inline]
fn clean_char(c: char) -> char {
    if c.is_control()
        || matches!(
            c,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
        )
    {
        '-'
    } else {
        c
    }
}

/// Windows-safe file/folder name for `title`; `fallback` when nothing is left.
pub fn safe_name(title: &str, fallback: &str) -> String {
    let cleaned: String = title.chars().map(clean_char).take(MAX_NAME_CHARS).collect();
    // Windows silently drops trailing dots and spaces.
    let mut name = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    if name.is_empty() {
        name = fallback.to_string();
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        name.insert(0, '_');
    }
    name
}

fn has_sibling_clash(conn: &Connection, meta: &ObjectMeta, name: &str) -> Result<bool, CoreError> {
    let first_name = name.chars().next();
    let check = |stmt: &mut rusqlite::Statement<'_>,
                 p: &[&dyn rusqlite::ToSql]|
     -> Result<bool, CoreError> {
        let mut rows = stmt.query(p).map_err(storage_error)?;
        while let Some(row) = rows.next().map_err(storage_error)? {
            let sib_title = row
                .get_ref(1)
                .map_err(storage_error)?
                .as_str()
                .map_err(storage_error)?;
            if !name.starts_with('_') {
                if let Some(fc) = sib_title
                    .chars()
                    .take(MAX_NAME_CHARS)
                    .find(|&c| !(c.is_whitespace() && !c.is_control()) && c != '.')
                    .map(clean_char)
                {
                    if first_name != Some(fc)
                        && !first_name.is_some_and(|n| n.eq_ignore_ascii_case(&fc))
                    {
                        continue;
                    }
                    if sib_title.len() < name.len() {
                        continue;
                    }
                }
            }
            let sib_id = row
                .get_ref(0)
                .map_err(storage_error)?
                .as_str()
                .map_err(storage_error)?;
            if safe_name(sib_title, sib_id).eq_ignore_ascii_case(name) {
                return Ok(true);
            }
        }
        Ok(false)
    };
    match &meta.parent {
        Some(pid) => {
            let mut stmt = conn
                .prepare_cached(
                    "SELECT id, title FROM objects WHERE parent = ?1 AND archived = 0 AND id != ?2",
                )
                .map_err(storage_error)?;
            check(&mut stmt, params![pid.0, meta.id.0])
        }
        None => {
            let mut stmt = conn
                .prepare_cached(
                    "SELECT id, title FROM objects WHERE parent IS NULL AND archived = 0 AND id != ?1",
                )
                .map_err(storage_error)?;
            check(&mut stmt, params![meta.id.0])
        }
    }
}

/// Path of the object's `.md`, relative to the vault: parent titles as
/// folders, then the title. Siblings with the same (case-insensitive) name get
/// a short id suffix so no export overwrites another.
pub fn relative_path(conn: &Connection, meta: &ObjectMeta) -> Result<PathBuf, CoreError> {
    let mut folders = Vec::new();
    let mut parent = meta.parent.clone();
    while let Some(id) = parent {
        if folders.len() >= MAX_DEPTH {
            return Err(storage_error("object tree too deep (cycle?)"));
        }
        let p =
            object_store::get(conn, &id)?.ok_or_else(|| CoreError::ObjectNotFound(id.0.clone()))?;
        folders.push(safe_name(&p.title, &p.id.0));
        parent = p.parent;
    }
    let name = safe_name(&meta.title, &meta.id.0);
    let clash = has_sibling_clash(conn, meta, &name)?;
    let file = if clash {
        format!("{name} ({}).md", short(&meta.id))
    } else {
        format!("{name}.md")
    };
    Ok(folders.into_iter().rev().chain([file]).collect())
}

fn short(id: &ObjectId) -> &str {
    id.0.get(id.0.len().saturating_sub(6)..).unwrap_or(&id.0)
}

fn type_name(t: &TypeKey) -> String {
    match t {
        TypeKey::Page => "page".into(),
        TypeKey::Journal => "journal".into(),
        TypeKey::Builtin(s) | TypeKey::Custom(s) => s.clone(),
    }
}

fn yaml(s: &str) -> Result<String, CoreError> {
    // A JSON string is a valid YAML double-quoted scalar.
    serde_json::to_string(s).map_err(storage_error)
}

/// Full `.md` content: frontmatter (`id`, `types`, `tags`, `created`, `updated`) + body.
pub fn render(meta: &ObjectMeta, state: &[u8]) -> Result<String, CoreError> {
    if state.is_empty() {
        return Ok(String::new());
    }
    let types = meta
        .types
        .iter()
        .map(|t| yaml(&type_name(t)))
        .collect::<Result<Vec<_>, _>>()?;
    let doc = Doc::new();
    let body = doc.get_or_insert_xml_fragment("body");
    let mut txn = doc.transact_mut();
    let update =
        Update::decode_v1(state).map_err(|e| storage_error(format!("corrupt Yjs state: {e}")))?;
    txn.apply_update(update)
        .map_err(|e| storage_error(format!("corrupt Yjs state: {e}")))?;
    let blocks: Vec<String> = body
        .children(&txn)
        .filter_map(|n| block(&n, &txn, 0))
        .collect();
    // Tags are filled by the indexer (#19); the key is already part of the format.
    Ok(format!(
        "---\nid: {}\ntypes: [{}]\ntags: []\ncreated: {}\nupdated: {}\n---\n\n{}\n",
        yaml(&meta.id.0)?,
        types.join(", "),
        yaml(&meta.created_at)?,
        yaml(&meta.updated_at)?,
        blocks.join("\n\n")
    ))
}

fn attr<T: ReadTxn>(e: &XmlElementRef, txn: &T, name: &str) -> Option<Any> {
    match e.get_attribute(txn, name)? {
        Out::Any(a) => Some(a),
        _ => None,
    }
}

fn number(a: Option<Any>) -> Option<i64> {
    match a? {
        Any::Number(n) => n.as_f64().map(|f| f as i64),
        Any::String(s) => s.parse().ok(),
        _ => None,
    }
}

fn inline<T: ReadTxn>(t: &XmlTextRef, txn: &T) -> String {
    let mut out = String::new();
    for chunk in t.diff(txn, YChange::identity) {
        let Out::Any(Any::String(s)) = &chunk.insert else {
            continue;
        };
        let marks = chunk.attributes.as_deref();
        let has = |k: &str| marks.is_some_and(|m| m.contains_key(k));
        let mut piece = s.to_string();
        if has("code") {
            piece = format!("`{piece}`");
        } else {
            for (mark, wrap) in [("bold", "**"), ("italic", "*"), ("strike", "~~")] {
                if has(mark) {
                    piece = format!("{wrap}{piece}{wrap}");
                }
            }
        }
        if let Some(Any::Map(link)) = marks.and_then(|m| m.get("link")) {
            if let Some(Any::String(href)) = link.get("href") {
                piece = format!("[{piece}]({href})");
            }
        }
        out.push_str(&piece);
    }
    out
}

/// Text of a node's inline children (text runs and hard breaks).
fn inlines<T: ReadTxn>(e: &XmlElementRef, txn: &T) -> String {
    e.children(txn)
        .map(|c| match c {
            XmlOut::Text(t) => inline(&t, txn),
            XmlOut::Element(el) if el.tag().as_ref() == "hardBreak" => "  \n".into(),
            _ => String::new(),
        })
        .collect()
}

fn indent(text: &str, first: &str) -> String {
    let pad = " ".repeat(first.chars().count());
    text.lines()
        .enumerate()
        .map(|(i, l)| {
            if i == 0 {
                format!("{first}{l}")
            } else if l.is_empty() {
                String::new()
            } else {
                format!("{pad}{l}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn block<T: ReadTxn>(node: &XmlOut, txn: &T, depth: usize) -> Option<String> {
    if depth >= MAX_DEPTH {
        return None;
    }
    let e = match node {
        XmlOut::Element(e) => e,
        XmlOut::Text(t) => return Some(inline(t, txn)),
        XmlOut::Fragment(_) => return None,
    };
    let children = |sep: &str| {
        e.children(txn)
            .filter_map(|c| block(&c, txn, depth + 1))
            .collect::<Vec<_>>()
            .join(sep)
    };
    Some(match e.tag().as_ref() {
        "paragraph" => inlines(e, txn),
        "heading" => {
            let level = number(attr(e, txn, "level")).unwrap_or(1).clamp(1, 6);
            format!("{} {}", "#".repeat(level as usize), inlines(e, txn))
        }
        "blockquote" => children("\n\n")
            .lines()
            .map(|l| {
                if l.is_empty() {
                    ">".to_string()
                } else {
                    format!("> {l}")
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        "codeBlock" => {
            let lang = match attr(e, txn, "language") {
                Some(Any::String(s)) => s.to_string(),
                _ => String::new(),
            };
            format!("```{lang}\n{}\n```", inlines(e, txn))
        }
        "horizontalRule" => "---".into(),
        list @ ("bulletList" | "orderedList" | "taskList") => e
            .children(txn)
            .enumerate()
            .map(|(i, item)| {
                let marker = match (list, &item) {
                    ("orderedList", _) => format!("{}. ", i + 1),
                    ("taskList", XmlOut::Element(it)) => {
                        let done = matches!(attr(it, txn, "checked"), Some(Any::Bool(true)));
                        if done {
                            "- [x] ".into()
                        } else {
                            "- [ ] ".into()
                        }
                    }
                    _ => "- ".into(),
                };
                let content = match &item {
                    XmlOut::Element(it) => it
                        .children(txn)
                        .filter_map(|c| block(&c, txn, depth + 1))
                        .collect::<Vec<_>>()
                        .join("\n"),
                    other => block(other, txn, depth + 1).unwrap_or_default(),
                };
                indent(&content, &marker)
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => children("\n\n"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::objects::NewObject;
    use crate::storage::open_vault;
    use std::collections::HashMap;
    use std::sync::Arc;
    use yrs::{StateVector, XmlElementPrelim, XmlTextPrelim};

    fn mark(name: &str, attrs: &[(&str, &str)]) -> HashMap<Arc<str>, Any> {
        let value: HashMap<String, Any> = attrs
            .iter()
            .map(|(k, v)| (k.to_string(), Any::from(*v)))
            .collect();
        HashMap::from([(Arc::from(name), Any::Map(Arc::new(value)))])
    }

    fn meta(title: &str, parent: Option<ObjectId>) -> NewObject {
        NewObject {
            types: vec![TypeKey::Page],
            title: title.into(),
            icon: None,
            parent,
        }
    }

    #[test]
    fn renders_tiptap_blocks_and_marks_as_markdown() {
        let doc = Doc::new();
        let body = doc.get_or_insert_xml_fragment("body");
        {
            let mut txn = doc.transact_mut();
            let h = body.push_back(&mut txn, XmlElementPrelim::empty("heading"));
            h.insert_attribute(&mut txn, "level", Any::from(2.0));
            h.push_back(&mut txn, XmlTextPrelim::new("Plan"));
            let p = body.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
            let t = p.push_back(&mut txn, XmlTextPrelim::new("Hola "));
            t.insert_with_attributes(&mut txn, 5, "mundo", mark("bold", &[]));
            t.insert_with_attributes(
                &mut txn,
                10,
                " web",
                mark("link", &[("href", "https://example.com")]),
            );
            let tasks = body.push_back(&mut txn, XmlElementPrelim::empty("taskList"));
            for (text, done) in [("Escribir", true), ("Publicar", false)] {
                let item = tasks.push_back(&mut txn, XmlElementPrelim::empty("taskItem"));
                item.insert_attribute(&mut txn, "checked", Any::Bool(done));
                let p = item.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
                p.push_back(&mut txn, XmlTextPrelim::new(text));
            }
            let q = body.push_back(&mut txn, XmlElementPrelim::empty("blockquote"));
            let qp = q.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
            qp.push_back(&mut txn, XmlTextPrelim::new("Cita"));
            let code = body.push_back(&mut txn, XmlElementPrelim::empty("codeBlock"));
            code.insert_attribute(&mut txn, "language", Any::from("rust"));
            code.push_back(&mut txn, XmlTextPrelim::new("fn main() {}"));
        }
        let state = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        let conn = open_vault(":memory:").unwrap();
        let m = object_store::create(&conn, meta("Plan", None)).unwrap();
        assert_eq!(render(&m, &[]).unwrap(), "");
        let md = render(&m, &state).unwrap();
        assert!(
            md.starts_with(&format!(
                "---\nid: \"{}\"\ntypes: [\"page\"]\ntags: []\n",
                m.id.0
            )),
            "{md}"
        );
        let body = md.split("---\n\n").nth(1).unwrap();
        assert_eq!(
            body,
            "## Plan\n\nHola **mundo**[ web](https://example.com)\n\n- [x] Escribir\n- [ ] Publicar\n\n> Cita\n\n```rust\nfn main() {}\n```\n"
        );
    }

    #[test]
    fn names_are_windows_safe() {
        assert_eq!(
            safe_name("a<b>c:d\"e/f\\g|h?i*j", "x"),
            "a-b-c-d-e-f-g-h-i-j"
        );
        assert_eq!(safe_name("con", "x"), "_con");
        assert_eq!(safe_name("LPT1.notes", "x"), "_LPT1.notes");
        assert_eq!(safe_name("Fin.. ", "x"), "Fin");
        assert_eq!(safe_name("   ", "01ABC"), "01ABC");
        assert_eq!(
            safe_name(&"ñ".repeat(300), "x").chars().count(),
            MAX_NAME_CHARS
        );
        assert_eq!(safe_name("Plan 2026 🚀", "x"), "Plan 2026 🚀");
    }

    #[test]
    fn paths_follow_the_tree_and_never_collide() {
        let conn = open_vault(":memory:").unwrap();
        let area = object_store::create(&conn, meta("Área: Ventas", None)).unwrap();
        let a = object_store::create(&conn, meta("Plan", Some(area.id.clone()))).unwrap();
        let b = object_store::create(&conn, meta("plan", Some(area.id.clone()))).unwrap();
        let root = object_store::create(&conn, meta("Plan", None)).unwrap();
        let pa = relative_path(&conn, &a).unwrap();
        let pb = relative_path(&conn, &b).unwrap();
        assert_eq!(pa.parent().unwrap(), PathBuf::from("Área- Ventas"));
        assert_ne!(pa, pb);
        assert!(
            pb.to_string_lossy()
                .ends_with(&format!("plan ({}).md", short(&b.id)))
        );
        assert_eq!(
            relative_path(&conn, &root).unwrap(),
            PathBuf::from("Plan.md")
        );
    }
}
