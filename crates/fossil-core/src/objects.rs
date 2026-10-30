//! Object graph types — the shared contract for storage, IPC and the editor
//! (spec r1-objects-storage §Model, ADR-0005).

use serde::{Deserialize, Serialize};

use crate::ids::{BlockId, ObjectId};

/// Built-in object types plus per-vault custom types.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum TypeKey {
    Page,
    Journal,
    Builtin(String),
    /// `Custom(<vault-local id>)`.
    Custom(String),
}

/// Metadata of a persisted object. The body lives in its Yjs document
/// (`object_updates`/`object_snapshots`), never here.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ObjectMeta {
    pub id: ObjectId,
    pub types: Vec<TypeKey>,
    pub title: String,
    pub icon: Option<String>,
    pub parent: Option<ObjectId>,
    /// ISO-8601 UTC (e.g. `2026-10-14T03:00:00.123Z`). SQLite keeps INTEGER
    /// milliseconds; conversion lives in the storage layer. Strings because
    /// specta-typescript forbids 64-bit integers in the generated contract.
    pub created_at: String,
    /// ISO-8601 UTC, same format as `created_at`.
    pub updated_at: String,
    pub archived: bool,
}

/// Payload to create an object; `id` and timestamps are assigned by the vault.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct NewObject {
    pub types: Vec<TypeKey>,
    pub title: String,
    pub icon: Option<String>,
    pub parent: Option<ObjectId>,
}

/// List filter; `None`/`false` mean "do not filter by this".
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ObjectFilter {
    #[serde(default)]
    pub include_archived: bool,
    pub type_key: Option<TypeKey>,
    pub parent: Option<ObjectId>,
    /// Free-text query over title (FTS arrives with the indexer).
    pub query: Option<String>,
}

/// Partial metadata update; `None` fields stay unchanged.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct MetaPatch {
    pub title: Option<String>,
    pub icon: Option<String>,
    pub types: Option<Vec<TypeKey>>,
    pub archived: Option<bool>,
}

/// How two objects got connected.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum LinkKind {
    Wikilink,
    Ref,
    Embed,
    Tag,
}

/// A directed connection extracted from an object's content.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Link {
    pub from_object: ObjectId,
    pub from_block: Option<BlockId>,
    pub to_object: ObjectId,
    pub to_block: Option<BlockId>,
    pub kind: LinkKind,
}

/// A link leaving a page (outgoing links panel): `to_object` is the live page it
/// resolves to, or `None` when no live page answers to `target` yet.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct OutgoingLink {
    pub from_block: Option<BlockId>,
    pub to_object: Option<ObjectId>,
    /// Title of the resolved page, or the text the link points to when unresolved.
    pub target: String,
    pub kind: LinkKind,
}

/// An object whose title matches another object's content without a link yet.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Mention {
    pub object_id: ObjectId,
    pub snippet: String,
}

/// Longest title `object_rename` accepts, in characters (r1-safe-rename, #128).
pub const MAX_TITLE_CHARS: usize = 200;

/// Outcome of `object_rename` (r1-safe-rename, #128).
///
/// Every inbound wikilink is rewritten in the Yjs document of the page that
/// holds it, archived source pages included (restoring them never brings back
/// a stale link). Self-links in the renamed page are rewritten too.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct RenameReport {
    /// Metadata after the rename (same as `object_update_meta` returns).
    pub meta: ObjectMeta,
    /// Wikilink occurrences rewritten, self-links included.
    pub updated_links: u32,
    /// Inbound links the index attributes to this object that could not be
    /// rewritten (the text no longer matches, e.g. a stale index or a link
    /// split by formatting marks). They stay as written and show up in
    /// `links_broken` once they stop resolving.
    pub unresolved: u32,
}

/// Why `links_broken` reports a wikilink.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum BrokenLinkReason {
    /// No object, archived or not, has that id or title.
    Missing,
    /// Only archived objects match: restoring one fixes the link.
    Archived,
    /// A title-form link (`[[Título]]`) matching two or more non-archived
    /// objects; it resolves to the oldest one. Id-form links are never ambiguous.
    Ambiguous,
}

/// A wikilink that does not resolve to exactly one non-archived object.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct BrokenLink {
    pub from_object: ObjectId,
    pub from_block: Option<BlockId>,
    /// The target as written between `[[` and the first `#` or `|`, trimmed.
    pub target_text: String,
    pub reason: BrokenLinkReason,
}

/// Typed errors shared by every IPC command in R1.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error, Serialize, Deserialize, specta::Type)]
pub enum CoreError {
    /// The command is part of the fixed contract but not implemented yet.
    #[error("not implemented yet (contract #15)")]
    NotImplemented,
    #[error("no vault is open")]
    VaultNotOpen,
    #[error("object {0} not found")]
    ObjectNotFound(String),
    #[error("storage error: {0}")]
    Storage(String),
    /// `object_move`: the target parent (or one of its ancestors) does not
    /// exist in the open vault. Ids from another Espacio land here too.
    #[error("parent {0} not found in this vault")]
    ParentNotFound(String),
    /// `object_move`: the target parent or one of its ancestors is archived.
    #[error("parent {0} is archived")]
    ParentArchived(String),
    /// `object_move`: the moved object would end up inside itself or a descendant.
    #[error("cannot move {0} into itself or one of its descendants")]
    MoveCycle(String),
    /// `object_rename`: the title is empty after trimming, longer than
    /// [`MAX_TITLE_CHARS`], has control characters (newlines included) or
    /// contains `[[` / `]]`, which no wikilink can hold.
    #[error("invalid title: {0}")]
    InvalidTitle(String),
}

#[cfg(test)]
mod tests {
    use super::{LinkKind, Mention, ObjectMeta, TypeKey};
    use crate::ids::ObjectId;

    fn sample_meta() -> ObjectMeta {
        ObjectMeta {
            id: ObjectId::new(),
            types: vec![TypeKey::Page],
            title: "Nota de kickoff".into(),
            icon: Some("📄".into()),
            parent: None,
            created_at: "2026-10-14T03:00:00.123Z".into(),
            updated_at: "2026-10-14T03:00:00.123Z".into(),
            archived: false,
        }
    }

    #[test]
    fn meta_serializes_all_fields_snake_case() {
        let json = serde_json::to_value(sample_meta()).unwrap();
        for key in [
            "id",
            "types",
            "title",
            "icon",
            "parent",
            "created_at",
            "updated_at",
            "archived",
        ] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
        assert_eq!(json["types"][0], "Page");
    }

    #[test]
    fn builtin_and_custom_types_round_trip() {
        for key in [
            TypeKey::Builtin("task".into()),
            TypeKey::Custom("01J8Z".into()),
        ] {
            let json = serde_json::to_string(&key).unwrap();
            let back: TypeKey = serde_json::from_str(&json).unwrap();
            assert_eq!(back, key);
        }
    }

    #[test]
    fn link_and_mention_carry_ids() {
        let link = super::Link {
            from_object: ObjectId::new(),
            from_block: None,
            to_object: ObjectId::new(),
            to_block: None,
            kind: LinkKind::Wikilink,
        };
        let json = serde_json::to_value(&link).unwrap();
        assert_eq!(json["kind"], "Wikilink");
        let mention = Mention {
            object_id: ObjectId::new(),
            snippet: "menciona el kickoff".into(),
        };
        assert!(serde_json::to_value(&mention).unwrap()["snippet"].is_string());
    }

    #[test]
    fn broken_links_and_rename_reports_serialize_for_the_ui() {
        let broken = super::BrokenLink {
            from_object: ObjectId::new(),
            from_block: None,
            target_text: "Plan Acme".into(),
            reason: super::BrokenLinkReason::Ambiguous,
        };
        let json = serde_json::to_value(&broken).unwrap();
        assert_eq!(
            (json["reason"].as_str(), json["from_block"].is_null()),
            (Some("Ambiguous"), true)
        );
        let report = super::RenameReport {
            meta: sample_meta(),
            updated_links: 3,
            unresolved: 1,
        };
        let json = serde_json::to_value(&report).unwrap();
        assert_eq!(
            (json["updated_links"].as_u64(), json["unresolved"].as_u64()),
            (Some(3), Some(1))
        );
        assert_eq!(json["meta"]["title"], "Nota de kickoff");
    }
}
