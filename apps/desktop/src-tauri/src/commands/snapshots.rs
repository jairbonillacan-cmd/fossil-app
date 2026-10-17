//! Data-trust IPC contract (spec r1-trust §Contrato propuesto, #160, ADR-0018):
//! workspace snapshots, restore without overwrite, local page versions and the
//! Markdown mirror round-trip check.
//!
//! Stub signatures fixed by this contract: bodies return
//! [`CoreError::NotImplemented`] until `r1-snapshots`, `r1-page-history` and
//! `r1-mirror-roundtrip` land. Implementations may inject `tauri::State` /
//! `AppHandle` (Rust only); the TS contract must not change without a
//! `type:contract` issue. Every argument is hostile: validate ids as Ulid and
//! paths with `fs_guard` before use.

use super::objects::VaultInfo;
use fossil_core::ids::ObjectId;
use fossil_core::objects::{CoreError, ObjectMeta};
use fossil_core::snapshots::{
    MirrorRoundtripReport, PageVersionDiff, PageVersionSummary, RestoreConflictPolicy,
    SnapshotTriggerKind, WorkspaceSnapshotMeta,
};

macro_rules! stub {
    ($(#[$meta:meta])* $vis:vis fn $name:ident($($arg:ident: $ty:ty),*) -> $ret:ty) => {
        $(#[$meta])*
        #[tauri::command]
        #[specta::specta]
        #[allow(unused_variables)] // contract stubs: bodies arrive with r1-snapshots and co.
        $vis fn $name($($arg: $ty),*) -> $ret {
            Err(CoreError::NotImplemented)
        }
    };
}

stub!(
    /// Seals a consistent snapshot of the open Espacio (`VACUUM INTO` on a
    /// read-only connection + `PRAGMA quick_check`, ADR-0018).
    pub fn snapshot_create(trigger_kind: SnapshotTriggerKind) -> Result<WorkspaceSnapshotMeta, CoreError>
);
stub!(
    /// Snapshots of the open Espacio, newest first.
    pub fn snapshot_list() -> Result<Vec<WorkspaceSnapshotMeta>, CoreError>
);
stub!(
    /// Restores the whole Espacio into a new local folder (never over the original).
    pub fn snapshot_restore_workspace(snapshot_id: String, target_dir: String) -> Result<VaultInfo, CoreError>
);
stub!(
    /// Restores one page from a snapshot following `policy`.
    pub fn snapshot_restore_page(snapshot_id: String, object_id: ObjectId, policy: RestoreConflictPolicy) -> Result<ObjectMeta, CoreError>
);
stub!(
    /// Restores `attachments/<ulid>.<ext>` listed in the snapshot manifest; returns its relative path.
    pub fn snapshot_restore_attachment(snapshot_id: String, relative_path: String) -> Result<String, CoreError>
);
stub!(
    /// A page's Historial de versiones, newest first.
    pub fn page_version_list(object_id: ObjectId) -> Result<Vec<PageVersionSummary>, CoreError>
);
stub!(
    /// A version against the current page, as Markdown.
    pub fn page_version_diff(object_id: ObjectId, version_id: String) -> Result<PageVersionDiff, CoreError>
);
stub!(
    /// Restores a version over the same object id after saving a `PreRestore` version.
    pub fn page_version_restore(object_id: ObjectId, version_id: String) -> Result<ObjectMeta, CoreError>
);
stub!(
    /// Exports the mirror and re-imports it in a clean Espacio, reporting what degrades.
    pub fn mirror_roundtrip_verify() -> Result<MirrorRoundtripReport, CoreError>
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_contract_stub_returns_not_implemented() {
        let id = ObjectId::new;
        let s = String::new;
        let errors = [
            snapshot_create(SnapshotTriggerKind::Manual).err(),
            snapshot_list().err(),
            snapshot_restore_workspace(s(), s()).err(),
            snapshot_restore_page(s(), id(), RestoreConflictPolicy::CreateCopy).err(),
            snapshot_restore_attachment(s(), "../x.png".into()).err(),
            page_version_list(id()).err(),
            page_version_diff(id(), s()).err(),
            page_version_restore(id(), s()).err(),
            mirror_roundtrip_verify().err(),
        ];
        for error in errors {
            assert_eq!(error, Some(CoreError::NotImplemented));
        }
    }
}
