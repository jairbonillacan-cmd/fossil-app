//! Pasted or dropped images, stored as files in `<vault>/attachments/` (#110).
//!
//! The Yjs document only keeps the relative path, never the bytes: binaries in
//! the CRDT would bloat every update log and sync.
use crate::{fs_guard, object_store::storage_error, objects::CoreError};
use std::{fs, io::Read, path::Path};

pub const ATTACHMENTS_DIR: &str = "attachments";
/// Upper bound per file: larger images are almost always a mistake (raw camera exports).
pub const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;

/// Image extensions accepted (lowercase).
const SUPPORTED: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];

/// Each extension comes with a check of the file's magic bytes so a
/// renamed executable never lands in the vault as an "image".
fn matches_signature(extension: &str, bytes: &[u8]) -> bool {
    match extension {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

fn extension_of(name: &str) -> Option<String> {
    let (_, extension) = name.rsplit_once('.')?;
    Some(extension.to_ascii_lowercase())
}

/// Copies `bytes` into `<root>/attachments/<ulid>.<ext>` and returns the
/// vault-relative path (`attachments/<ulid>.<ext>`, always with `/`).
pub fn save(root: &Path, file_name: &str, bytes: &[u8]) -> Result<String, CoreError> {
    let extension =
        extension_of(file_name).ok_or_else(|| storage_error("attachment has no file extension"))?;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(storage_error("attachment is larger than 20 MB"));
    }
    if !matches_signature(&extension, bytes) {
        return Err(storage_error(format!(
            "attachment is not a supported .{extension} image"
        )));
    }
    let dir = root.join(ATTACHMENTS_DIR);
    fs_guard::reject_link(&dir)?;
    fs::create_dir_all(&dir).map_err(storage_error)?;
    let name = format!("{}.{extension}", ulid::Ulid::generate());
    // Atomic: a crash mid-write leaves a temp file, never a truncated image.
    let temporary = dir.join(format!("{name}.tmp"));
    fs::write(&temporary, bytes).map_err(storage_error)?;
    if let Err(error) = fs::rename(&temporary, dir.join(&name)) {
        let _ = fs::remove_file(temporary);
        return Err(storage_error(error));
    }
    Ok(format!("{ATTACHMENTS_DIR}/{name}"))
}

/// `attachments/<name>` → `<name>` when it is a well-formed attachment path:
/// one flat component of `[A-Za-z0-9._-]`, no leading dot, no device name and
/// a supported image extension. Shared by `load` and the snapshot engine.
pub(crate) fn valid_relative(relative: &str) -> Option<&str> {
    let name = relative.strip_prefix("attachments/").filter(|name| {
        !name.is_empty()
            && !name.starts_with('.')
            && !fs_guard::is_reserved_device(name)
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    })?;
    extension_of(name)
        .is_some_and(|ext| SUPPORTED.contains(&ext.as_str()))
        .then_some(name)
}

/// Reads an attachment by the relative path [`save`] returned. Anything else
/// (other folders, `..`, nested paths) is rejected, so the webview can never
/// read arbitrary files through this command.
pub fn load(root: &Path, relative: &str) -> Result<Vec<u8>, CoreError> {
    let name = valid_relative(relative).ok_or_else(|| storage_error("invalid attachment path"))?;
    fs_guard::reject_link(&root.join(ATTACHMENTS_DIR))?;
    let path = root.join(ATTACHMENTS_DIR).join(name);
    fs_guard::reject_link(&path)?;
    // Size is checked before reading: a file dropped into the folder by hand
    // must never be pulled whole into memory (and base64-encoded for IPC).
    let size = fs::symlink_metadata(&path).map_err(storage_error)?.len();
    if size > MAX_ATTACHMENT_BYTES as u64 {
        return Err(storage_error("attachment is larger than 20 MB"));
    }
    let mut bytes = Vec::new();
    // `take` also bounds a file that grows between the check and the read.
    fs::File::open(&path)
        .and_then(|file| {
            file.take(MAX_ATTACHMENT_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
        })
        .map_err(storage_error)?;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(storage_error("attachment is larger than 20 MB"));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nrest-of-image";

    #[test]
    fn saves_with_a_fresh_name_and_loads_back() {
        let dir = tempfile::tempdir().unwrap();
        let first = save(dir.path(), "Captura de pantalla 2026.PNG", PNG).unwrap();
        let second = save(dir.path(), "Captura de pantalla 2026.PNG", PNG).unwrap();
        assert!(
            first.starts_with("attachments/") && first.ends_with(".png"),
            "{first}"
        );
        assert_ne!(first, second, "same name never overwrites");
        assert_eq!(load(dir.path(), &first).unwrap(), PNG);
        let leftovers = fs::read_dir(dir.path().join(ATTACHMENTS_DIR))
            .unwrap()
            .filter(|entry| entry.as_ref().unwrap().path().extension().unwrap() == "tmp")
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn accepts_every_supported_format() {
        let dir = tempfile::tempdir().unwrap();
        for (name, bytes) in [
            ("a.jpg", &[0xFF, 0xD8, 0xFF, 0xE0][..]),
            ("a.jpeg", &[0xFF, 0xD8, 0xFF, 0xE1][..]),
            ("a.gif", &b"GIF87a.."[..]),
            ("a.webp", &b"RIFF\x10\0\0\0WEBPVP8 "[..]),
        ] {
            save(dir.path(), name, bytes).unwrap_or_else(|e| panic!("{name}: {e}"));
        }
    }

    #[test]
    fn rejects_wrong_content_unknown_types_and_oversize() {
        let dir = tempfile::tempdir().unwrap();
        assert!(save(dir.path(), "virus.png", b"MZ\x90\0").is_err());
        assert!(save(dir.path(), "notes.txt", b"hola").is_err());
        assert!(save(dir.path(), "sin-extension", PNG).is_err());
        let mut huge = PNG.to_vec();
        huge.resize(MAX_ATTACHMENT_BYTES + 1, 0);
        assert!(save(dir.path(), "big.png", &huge).is_err());
        assert!(
            !dir.path().join(ATTACHMENTS_DIR).exists(),
            "nothing written"
        );
    }

    #[test]
    fn load_refuses_oversize_files_without_reading_them() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join(ATTACHMENTS_DIR);
        fs::create_dir_all(&folder).unwrap();
        // Sparse file: reports 21 MB without allocating it on disk.
        let file = fs::File::create(folder.join("big.png")).unwrap();
        file.set_len(MAX_ATTACHMENT_BYTES as u64 + 1024 * 1024)
            .unwrap();
        drop(file);
        assert!(load(dir.path(), "attachments/big.png").is_err());
        let exact = fs::File::create(folder.join("limit.png")).unwrap();
        exact.set_len(MAX_ATTACHMENT_BYTES as u64).unwrap();
        drop(exact);
        assert_eq!(
            load(dir.path(), "attachments/limit.png").unwrap().len(),
            MAX_ATTACHMENT_BYTES
        );
    }

    #[test]
    fn load_only_reads_inside_attachments() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join(".fossil")).unwrap();
        fs::write(dir.path().join(".fossil/fossil.db"), "secret").unwrap();
        for path in [
            "attachments/../.fossil/fossil.db",
            "attachments\\..\\.fossil\\fossil.db",
            ".fossil/fossil.db",
            "attachments/",
            "attachments/sub/a.png",
            "attachments/.hidden.png",
            "attachments/a.txt",
            "C:/Windows/win.ini",
        ] {
            assert!(load(dir.path(), path).is_err(), "{path} must be rejected");
        }
    }

    #[test]
    fn load_refuses_windows_device_names() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join(ATTACHMENTS_DIR)).unwrap();
        // Windows 10 opens the device for these names; Windows 11 allows them
        // as ordinary files, so a real file is planted where the OS lets us.
        // CON is left out: reading the console device would block the test.
        for path in [
            "attachments/nul.png",
            "attachments/NUL.gif",
            "attachments/com1.jpg",
        ] {
            let _ = fs::write(dir.path().join(path), PNG);
            assert!(load(dir.path(), path).is_err(), "{path} must be rejected");
        }
    }

    // File symlinks need admin rights on Windows, so only the folder case is
    // covered (junctions need none); `reject_link` treats both alike.
    #[cfg(windows)]
    #[test]
    fn refuses_a_linked_attachments_folder() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("x.png"), PNG).unwrap();
        crate::fs_guard::tests::make_junction(&dir.path().join(ATTACHMENTS_DIR), outside.path());
        assert!(load(dir.path(), "attachments/x.png").is_err());
        assert!(save(dir.path(), "y.png", PNG).is_err());
    }
}
