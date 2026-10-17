//! Data-trust contract (spec r1-trust §Contrato propuesto, #160, ADR-0018):
//! workspace snapshots, restore, local page versions, save status and the
//! Markdown mirror round-trip report. Types only; the engines land in their
//! own issues (`r1-snapshots`, `r1-page-history`, `r1-save-chaos`,
//! `r1-mirror-roundtrip`).

use serde::{Deserialize, Serialize};

use crate::ids::ObjectId;

/// State of the Yjs transport batcher shown as Guardado / Guardando / Error.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum SaveStatusKind {
    Saved,
    Saving,
    Error,
}

/// Batcher status: `Saved` only when every sent delta was acknowledged.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct SaveStatus {
    pub kind: SaveStatusKind,
    /// Sequence of the first delta that failed, when `kind` is `Error`.
    pub failed_seq: Option<u32>,
    pub last_error: Option<String>,
}

/// Why a workspace snapshot was taken. SQL tag in `workspace_snapshots.trigger_kind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum SnapshotTriggerKind {
    Manual,
    Scheduled,
    PreImport,
    PreRestore,
}

impl SnapshotTriggerKind {
    pub const ALL: [Self; 4] = [
        Self::Manual,
        Self::Scheduled,
        Self::PreImport,
        Self::PreRestore,
    ];

    /// Value stored in SQLite (checked by migration 0003).
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Scheduled => "scheduled",
            Self::PreImport => "pre_import",
            Self::PreRestore => "pre_restore",
        }
    }

    /// Parses a stored tag; unknown values (hostile or newer data) are `None`.
    pub fn from_sql(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_sql() == value)
    }
}

/// Why a page version was captured. SQL tag in `object_versions.trigger_kind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum VersionTriggerKind {
    IdlePause,
    SignificantEdit,
    SessionClose,
    PreRestore,
    Manual,
}

impl VersionTriggerKind {
    pub const ALL: [Self; 5] = [
        Self::IdlePause,
        Self::SignificantEdit,
        Self::SessionClose,
        Self::PreRestore,
        Self::Manual,
    ];

    /// Value stored in SQLite (checked by migration 0003).
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::IdlePause => "idle_pause",
            Self::SignificantEdit => "significant_edit",
            Self::SessionClose => "session_close",
            Self::PreRestore => "pre_restore",
            Self::Manual => "manual",
        }
    }

    /// Parses a stored tag; unknown values (hostile or newer data) are `None`.
    pub fn from_sql(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_sql() == value)
    }
}

/// What `snapshot_restore_page` does when the page still exists: never
/// overwrite silently.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum RestoreConflictPolicy {
    /// Restore as a new page titled `"<Título> (restaurada)"`.
    CreateCopy,
    /// Save a `PreRestore` version of the current page, then restore over it.
    OverwriteWithBackupVersion,
}

/// A sealed workspace snapshot (row of `workspace_snapshots`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct WorkspaceSnapshotMeta {
    /// ULID.
    pub snapshot_id: String,
    pub trigger_kind: SnapshotTriggerKind,
    pub object_count: u32,
    pub attachment_count: u32,
    /// `f64` because specta-typescript forbids 64-bit integers; exact up to 2^53.
    pub total_bytes: f64,
    /// `PRAGMA quick_check` passed before sealing.
    pub integrity_ok: bool,
    /// ISO-8601 UTC.
    pub created_at: String,
}

/// One entry of a page's Historial de versiones (row of `object_versions`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct PageVersionSummary {
    /// ULID.
    pub version_id: String,
    pub object_id: ObjectId,
    pub title: String,
    pub trigger_kind: VersionTriggerKind,
    pub byte_size: u32,
    /// ISO-8601 UTC.
    pub created_at: String,
}

/// A version (`old_*`) against the current page (`new_*`), as Markdown.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct PageVersionDiff {
    pub version_id: String,
    pub old_title: String,
    pub new_title: String,
    pub old_markdown: String,
    pub new_markdown: String,
}

/// A construct the Markdown round-trip degraded or dropped.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct MirrorUnsupportedItem {
    /// Vault-relative `.md` path.
    pub path: String,
    pub reason: String,
}

/// Result of exporting the vault mirror and re-importing it in a clean vault.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct MirrorRoundtripReport {
    pub total_pages: u32,
    pub preserved_pages: u32,
    pub unsupported_items: Vec<MirrorUnsupportedItem>,
}

#[cfg(test)]
mod tests {
    use super::{SnapshotTriggerKind, VersionTriggerKind};

    #[test]
    fn sql_tags_round_trip_and_reject_unknown() {
        for kind in SnapshotTriggerKind::ALL {
            assert_eq!(SnapshotTriggerKind::from_sql(kind.as_sql()), Some(kind));
        }
        for kind in VersionTriggerKind::ALL {
            assert_eq!(VersionTriggerKind::from_sql(kind.as_sql()), Some(kind));
        }
        assert_eq!(SnapshotTriggerKind::from_sql("Manual"), None);
        assert_eq!(VersionTriggerKind::from_sql("x'; DROP TABLE objects"), None);
    }
}
