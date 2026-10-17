//! Restoring from a sealed snapshot without ever overwriting the original
//! (#161, spec `r1-trust` §Motor de restauración). Everything read from a
//! snapshot folder or received over IPC is hostile: the snapshot id is a Ulid,
//! the manifest is validated entry by entry, every file is checked against its
//! SHA-256 before use, and target paths go through `fs_guard`.
use crate::{
    attachments::{self, ATTACHMENTS_DIR},
    fs_guard,
    object_store::storage_error,
    objects::CoreError,
    snapshot_store::{
        MANIFEST, Manifest, backups_dir, check_database, copy_hashed, hash_file, valid_snapshot_id,
    },
    storage::open_vault,
};
use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};

/// A manifest is a few KB even with thousands of attachments; refuse anything huge.
const MAX_MANIFEST_BYTES: u64 = 8 * 1024 * 1024;
const FIXED_FILES: [&str; 3] = ["fossil.db", "vault.json", "mirror.json"];

fn invalid(what: &str) -> CoreError {
    storage_error(format!("invalid snapshot: {what}"))
}

/// Where a manifest path lands inside a restored Espacio.
fn destination(base: &Path, relative: &str) -> PathBuf {
    if FIXED_FILES.contains(&relative) {
        base.join(".fossil").join(relative)
    } else {
        base.join(relative)
    }
}

fn valid_entry_path(path: &str) -> bool {
    FIXED_FILES.contains(&path) || attachments::valid_relative(path).is_some()
}

/// Folder and validated manifest of a verified snapshot. Fails for snapshots
/// that did not pass `quick_check` when sealed.
pub(crate) fn read_manifest(root: &Path, id: &str) -> Result<(PathBuf, Manifest), CoreError> {
    valid_snapshot_id(id)?;
    let backups = backups_dir(root);
    let dir = backups.join(id);
    for part in [root.join(".fossil"), backups, dir.clone()] {
        fs_guard::reject_link(&part)?;
    }
    let path = dir.join(MANIFEST);
    fs_guard::reject_link(&path)?;
    let size = fs::metadata(&path).map_err(storage_error)?.len();
    if size > MAX_MANIFEST_BYTES {
        return Err(invalid("manifest is too large"));
    }
    let manifest: Manifest =
        serde_json::from_slice(&fs::read(&path).map_err(storage_error)?).map_err(storage_error)?;
    if manifest.version != 1 || manifest.snapshot_id != id {
        return Err(invalid("manifest does not belong to this snapshot"));
    }
    let mut seen = HashSet::new();
    for file in &manifest.files {
        let hash_ok = file.sha256.len() == 64
            && file
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if !valid_entry_path(&file.path) || !hash_ok || !seen.insert(file.path.as_str()) {
            return Err(invalid("manifest entry"));
        }
    }
    if !seen.contains("fossil.db") {
        return Err(invalid("manifest has no database"));
    }
    if !manifest.integrity_ok {
        return Err(invalid("it did not pass quick_check when it was sealed"));
    }
    Ok((dir, manifest))
}

/// Refuses anything but a new (or empty) local folder that is not behind a link.
fn check_target(root: &Path, target: &Path) -> Result<(), CoreError> {
    // Before any file-system call: resolving a UNC path already contacts the server.
    fs_guard::require_local_absolute(target)?;
    let mut walked = PathBuf::new();
    for component in target.components() {
        if let Component::Normal(name) = component {
            let name = name.to_string_lossy();
            if fs_guard::is_reserved_device(&name) || name.ends_with(['.', ' ']) {
                return Err(storage_error("restore folder has a reserved name"));
            }
        } else if matches!(component, Component::ParentDir | Component::CurDir) {
            return Err(storage_error("restore folder must not contain . or .."));
        }
        walked.push(component);
        if matches!(component, Component::Normal(_)) {
            fs_guard::reject_link(&walked)?;
        }
    }
    let anchor = if target.exists() {
        if !target.is_dir()
            || fs::read_dir(target)
                .map_err(storage_error)?
                .next()
                .is_some()
        {
            return Err(storage_error("restore folder must be new or empty"));
        }
        target
    } else {
        target
            .parent()
            .filter(|parent| parent.is_dir())
            .ok_or_else(|| storage_error("restore folder's parent does not exist"))?
    };
    let anchor = dunce::canonicalize(anchor).map_err(storage_error)?;
    let internal = dunce::canonicalize(root.join(".fossil")).map_err(storage_error)?;
    if anchor.starts_with(internal) {
        return Err(storage_error("restore folder cannot be inside .fossil"));
    }
    Ok(())
}

fn write_files(dir: &Path, manifest: &Manifest, target: &Path) -> Result<(), CoreError> {
    fs::create_dir(target.join(".fossil")).map_err(storage_error)?;
    for file in &manifest.files {
        let destination = destination(target, &file.path);
        if file.path.starts_with("attachments/") {
            fs::create_dir_all(target.join(ATTACHMENTS_DIR)).map_err(storage_error)?;
        }
        let temporary = destination.with_extension("restoring");
        let (sha256, _) = copy_hashed(&dir.join(&file.path), Some(&temporary))?;
        if sha256 != file.sha256 {
            let _ = fs::remove_file(&temporary);
            return Err(invalid("a file changed while it was being restored"));
        }
        fs::rename(&temporary, &destination).map_err(storage_error)?;
    }
    // The restored Espacio has no backups folder, so its copy of the list would
    // point to snapshots that do not exist there. Opening also migrates it.
    open_vault(
        destination(target, "fossil.db")
            .to_str()
            .ok_or_else(|| storage_error("invalid restore path"))?,
    )?
    .execute("DELETE FROM workspace_snapshots", [])
    .map_err(storage_error)?;
    Ok(())
}

/// Restores snapshot `id` of the Espacio at `root` into the new folder
/// `target`. Nothing in `root` is read from its live database or modified, so
/// a damaged original keeps its files and can still be restored. Returns the
/// canonical restored folder.
pub fn restore_workspace(root: &Path, id: &str, target: &Path) -> Result<PathBuf, CoreError> {
    let (dir, manifest) = read_manifest(root, id)?;
    check_target(root, target)?;
    for file in &manifest.files {
        let (sha256, bytes) = hash_file(&dir.join(&file.path))?;
        if sha256 != file.sha256 || bytes != file.bytes {
            return Err(invalid(&format!("{} does not match its hash", file.path)));
        }
    }
    // ADR-0018: the full check, not just quick_check, before activating a restore.
    if !check_database(&dir.join("fossil.db"), "integrity_check") {
        return Err(invalid("database failed integrity_check"));
    }
    let created = !target.exists();
    if created {
        fs::create_dir(target).map_err(storage_error)?;
    }
    write_files(&dir, &manifest, target).inspect_err(|_| {
        // Only what this call created; the folder was empty or new.
        let _ = fs::remove_dir_all(target.join(".fossil"));
        let _ = fs::remove_dir_all(target.join(ATTACHMENTS_DIR));
        if created {
            let _ = fs::remove_dir(target);
        }
    })?;
    dunce::canonicalize(target).map_err(storage_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        object_store,
        objects::{NewObject, TypeKey},
        snapshot_store::{build, record, tests::vault},
        snapshots::SnapshotTriggerKind,
    };

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nrest";

    fn sealed_vault() -> (tempfile::TempDir, String, String) {
        let (dir, conn) = vault();
        object_store::create(
            &conn,
            NewObject {
                types: vec![TypeKey::Page],
                title: "Plan".into(),
                icon: None,
                parent: None,
            },
        )
        .unwrap();
        let image = attachments::save(dir.path(), "a.png", PNG).unwrap();
        let sealed = build(dir.path(), SnapshotTriggerKind::Manual).unwrap();
        record(&conn, &sealed).unwrap();
        (dir, sealed.meta.snapshot_id, image)
    }

    #[test]
    fn restores_into_a_new_folder_and_leaves_the_original_alone() {
        let (dir, id, image) = sealed_vault();
        let before = hash_file(&dir.path().join(".fossil/fossil.db")).unwrap();
        let target = tempfile::tempdir().unwrap();
        let target = target.path().join("Acme restaurado");
        let restored = restore_workspace(dir.path(), &id, &target).unwrap();
        assert_eq!(fs::read(restored.join(&image)).unwrap(), PNG);
        assert_eq!(
            fs::read(restored.join(".fossil/vault.json")).unwrap(),
            b"\"Acme\""
        );
        let conn = open_vault(restored.join(".fossil/fossil.db").to_str().unwrap()).unwrap();
        let (pages, listed): (i64, i64) = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM objects), (SELECT COUNT(*) FROM workspace_snapshots)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((pages, listed), (1, 0));
        assert_eq!(
            hash_file(&dir.path().join(".fossil/fossil.db")).unwrap().0,
            before.0
        );
        // An existing, non-empty folder is never a target.
        assert!(restore_workspace(dir.path(), &id, &restored).is_err());
    }

    #[test]
    fn a_corrupt_database_is_restored_elsewhere_without_touching_the_damaged_files() {
        let (dir, id, _) = sealed_vault();
        let live = dir.path().join(".fossil/fossil.db");
        for sidecar in ["-wal", "-shm"] {
            let _ = fs::remove_file(format!("{}{sidecar}", live.display()));
        }
        fs::write(&live, vec![0x5A; 16 * 1024]).unwrap();
        let damaged = hash_file(&live).unwrap();
        assert!(build(dir.path(), SnapshotTriggerKind::Manual).is_err());
        let target = tempfile::tempdir().unwrap();
        let restored = restore_workspace(dir.path(), &id, &target.path().join("nuevo")).unwrap();
        assert!(check_database(
            &restored.join(".fossil/fossil.db"),
            "integrity_check"
        ));
        assert_eq!(hash_file(&live).unwrap(), damaged);
    }

    #[test]
    fn hostile_targets_are_refused_before_anything_is_written() {
        let (dir, id, _) = sealed_vault();
        let outside = tempfile::tempdir().unwrap();
        let base = outside.path();
        let mut targets = vec![
            base.join("CON"),
            base.join("PRN.db"),
            base.join("a.."),
            base.join("a").join("..").join("b"),
            base.join("missing-parent").join("x"),
            dir.path().join(".fossil").join("restored"),
            PathBuf::from("relative"),
        ];
        #[cfg(windows)]
        targets.extend(
            [
                r"\\127.0.0.1\share\vault",
                r"\\?\UNC\server\share\vault",
                r"\\.\NUL",
                r"\\.\PhysicalDrive0",
                r"C:vault",
            ]
            .map(PathBuf::from),
        );
        for target in targets {
            assert!(
                restore_workspace(dir.path(), &id, &target).is_err(),
                "{target:?}"
            );
        }
        #[cfg(windows)]
        {
            let real = base.join("real");
            fs::create_dir(&real).unwrap();
            let link = base.join("link");
            fs_guard::tests::make_junction(&link, &real);
            for target in [link.clone(), link.join("nuevo")] {
                assert!(
                    restore_workspace(dir.path(), &id, &target).is_err(),
                    "{target:?}"
                );
            }
            assert_eq!(fs::read_dir(&real).unwrap().count(), 0);
        }
        assert_eq!(
            fs::read_dir(base).unwrap().count(),
            if cfg!(windows) { 2 } else { 0 }
        );
    }

    #[test]
    fn tampered_or_forged_snapshots_are_rejected() {
        let (dir, id, image) = sealed_vault();
        let folder = backups_dir(dir.path()).join(&id);
        for bad in ["..", "..\\x", "a/b", &id.to_lowercase()] {
            assert!(read_manifest(dir.path(), bad).is_err(), "{bad}");
        }
        let manifest_path = folder.join(MANIFEST);
        let original = fs::read_to_string(&manifest_path).unwrap();
        for forged in [
            "../escape.png",
            "attachments/../../escape.png",
            "/etc/passwd",
            "attachments/CON.png",
            "attachments/x.exe",
            "unlisted.json",
        ] {
            let patched = original.replace(&image, forged);
            fs::write(&manifest_path, patched).unwrap();
            assert!(read_manifest(dir.path(), &id).is_err(), "{forged}");
        }
        fs::write(&manifest_path, &original).unwrap();
        assert!(read_manifest(dir.path(), &id).is_ok());
        // A byte flipped in a snapshot file is caught by the manifest hash.
        fs::write(folder.join(&image), b"tampered").unwrap();
        let target = tempfile::tempdir().unwrap();
        let nuevo = target.path().join("nuevo");
        assert!(restore_workspace(dir.path(), &id, &nuevo).is_err());
        assert!(!nuevo.exists());
    }
}
