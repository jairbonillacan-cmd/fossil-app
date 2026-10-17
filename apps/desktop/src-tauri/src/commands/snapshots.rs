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

use super::objects::{VaultInfo, VaultState, with_session};
use fossil_core::ids::ObjectId;
use fossil_core::objects::{CoreError, ObjectMeta};
use fossil_core::snapshots::{
    MirrorRoundtripReport, PageVersionDiff, PageVersionSummary, RestoreConflictPolicy,
    SnapshotTriggerKind, WorkspaceSnapshotMeta,
};
use fossil_core::{snapshot_restore, snapshot_store};
use std::path::Path;

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

/// Seals a consistent snapshot of the open Espacio (`VACUUM INTO` on a
/// read-only connection + `PRAGMA quick_check`, ADR-0018).
#[tauri::command]
#[specta::specta]
pub fn snapshot_create(
    state: tauri::State<'_, VaultState>,
    trigger_kind: SnapshotTriggerKind,
) -> Result<WorkspaceSnapshotMeta, CoreError> {
    create(state, trigger_kind)
}

fn create(
    state: tauri::State<'_, VaultState>,
    trigger: SnapshotTriggerKind,
) -> Result<WorkspaceSnapshotMeta, CoreError> {
    let root = vault_root(state.clone())?;
    // The copy runs outside the session lock: the editor keeps saving meanwhile.
    let sealed = snapshot_store::build(&root, trigger)?;
    let removed = with_session(state, |session| {
        snapshot_store::commit(session, &root, &sealed)
    })?;
    snapshot_store::remove_dirs(&root, &removed);
    Ok(sealed.meta)
}

/// Snapshots of the open Espacio, newest first.
#[tauri::command]
#[specta::specta]
pub fn snapshot_list(
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<WorkspaceSnapshotMeta>, CoreError> {
    with_session(state, |session| {
        session.with_connection(|conn| snapshot_store::list(conn))
    })
}

/// Restores the whole Espacio into a new local folder (never over the original).
/// The restored Espacio is not opened: the UI opens it with `vault_open`.
#[tauri::command]
#[specta::specta]
pub fn snapshot_restore_workspace(
    state: tauri::State<'_, VaultState>,
    snapshot_id: String,
    target_dir: String,
) -> Result<VaultInfo, CoreError> {
    let root = vault_root(state.clone())?;
    // Safety copy first; best effort, because a damaged live database is exactly
    // why someone restores (and restoring never modifies the original).
    if let Err(error) = create(state, SnapshotTriggerKind::PreRestore) {
        eprintln!("pre-restore snapshot skipped: {error}");
    }
    let restored =
        snapshot_restore::restore_workspace(&root, &snapshot_id, Path::new(&target_dir))?;
    let name = std::fs::read(restored.join(".fossil/vault.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<String>(&bytes).ok())
        .or_else(|| {
            restored
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
        })
        .unwrap_or_default();
    Ok(VaultInfo {
        path: restored.to_string_lossy().into_owned(),
        name,
    })
}

fn vault_root(state: tauri::State<'_, VaultState>) -> Result<std::path::PathBuf, CoreError> {
    with_session(state, |session| {
        session
            .root()
            .map(Path::to_path_buf)
            .ok_or(CoreError::VaultNotOpen)
    })
}
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
