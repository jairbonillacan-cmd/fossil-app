//! File-system checks shared by everything that opens a path inside a vault.
//! A vault folder can come from anywhere (a download, a shared drive), so its
//! paths and links are treated as hostile input.
use crate::{object_store::storage_error, objects::CoreError};
use std::{
    fs,
    path::{Component, Path},
};

/// Device names Windows refuses as file names, with or without extension.
const DEVICE_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// `true` when Windows would open a device instead of a file for `name`
/// (`CON`, `nul.png`, `COM1.tar.gz`…).
pub fn is_reserved_device(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_uppercase();
    DEVICE_NAMES.contains(&stem.as_str())
}

/// Accepts only absolute local paths (`C:\…`, or `/…` off Windows). Network
/// shares and device namespaces are refused *before* any file-system call,
/// because merely resolving a UNC path makes Windows connect to that server.
pub fn require_local_absolute(path: &Path) -> Result<(), CoreError> {
    let local = match path.components().next() {
        #[cfg(windows)]
        Some(Component::Prefix(prefix)) => matches!(
            prefix.kind(),
            std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)
        ),
        Some(Component::RootDir) => !cfg!(windows),
        _ => false,
    };
    if local && path.is_absolute() {
        Ok(())
    } else {
        Err(storage_error("vault path must be an absolute local folder"))
    }
}

/// Rejects `path` if it is a symbolic link, junction or any other reparse
/// point, so a link planted inside a vault cannot redirect reads or writes
/// outside of it. A missing path is fine: the caller decides what that means.
pub fn reject_link(path: &Path) -> Result<(), CoreError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if is_link(&meta) => Err(storage_error("links are not allowed inside a vault")),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(storage_error(error)),
    }
}

fn is_link(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    meta.file_type().is_symlink()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn device_names_with_or_without_extension() {
        for name in ["CON", "nul.png", "Com1.jpg", "lpt9.tar.gz", "AUX "] {
            assert!(is_reserved_device(name), "{name}");
        }
        for name in ["console.png", "a.png", "COM10.png", "conexion.webp"] {
            assert!(!is_reserved_device(name), "{name}");
        }
    }

    #[test]
    fn relative_paths_are_refused() {
        for path in ["vault", "./vault", "..\\vault", ""] {
            assert!(require_local_absolute(Path::new(path)).is_err(), "{path}");
        }
        let dir = tempfile::tempdir().unwrap();
        assert!(require_local_absolute(dir.path()).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn network_and_device_paths_are_refused() {
        for path in [
            r"\\127.0.0.1\share\vault",
            r"\\server\share",
            r"\\?\UNC\server\share\vault",
            r"\\.\NUL",
            r"\\.\PhysicalDrive0",
            r"C:vault",
            r"\vault",
        ] {
            assert!(require_local_absolute(Path::new(path)).is_err(), "{path}");
        }
        for path in [r"D:\Acme\Mi equipo", r"\\?\D:\Acme"] {
            assert!(require_local_absolute(Path::new(path)).is_ok(), "{path}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn junctions_are_links() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        fs::create_dir(&target).unwrap();
        let link = dir.path().join("link");
        make_junction(&link, &target);
        assert!(reject_link(&link).is_err());
        assert!(reject_link(&target).is_ok());
        assert!(reject_link(&dir.path().join("missing")).is_ok());
    }

    /// Junctions need no admin rights, unlike symbolic links on Windows.
    #[cfg(windows)]
    pub(crate) fn make_junction(link: &Path, target: &Path) {
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .unwrap();
        assert!(status.status.success(), "mklink /J failed: {status:?}");
    }
}
