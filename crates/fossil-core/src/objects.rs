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

/// An object whose title matches another object's content without a link yet.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Mention {
    pub object_id: ObjectId,
    pub snippet: String,
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
}
