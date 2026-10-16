//! Vault lifecycle and per-installation recent vaults (ADR-0004).
use crate::{fs_guard, object_store::storage_error, objects::CoreError, storage::open_vault};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultRecord {
    pub path: String,
    pub name: String,
}

#[derive(Default, Serialize, Deserialize)]
struct Config {
    #[serde(default)]
    recent: Vec<VaultRecord>,
    #[serde(flatten)]
    other: serde_json::Map<String, serde_json::Value>,
}

pub struct VaultSession {
    config: PathBuf,
    connection: Option<Connection>,
    /// Folder of the open vault (where the Markdown mirror is written).
    root: Option<PathBuf>,
}

impl VaultSession {
    pub fn new(config: PathBuf) -> Self {
        Self {
            config,
            connection: None,
            root: None,
        }
    }

    pub fn installation() -> Result<Self, CoreError> {
        let appdata =
            std::env::var_os("APPDATA").ok_or_else(|| storage_error("APPDATA unavailable"))?;
        Ok(Self::new(PathBuf::from(appdata).join("Fossil/config.json")))
    }

    fn config(&self) -> Result<Config, CoreError> {
        match fs::read(&self.config) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(storage_error),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
            Err(error) => Err(storage_error(error)),
        }
    }

    pub fn recent(&self) -> Result<Vec<VaultRecord>, CoreError> {
        Ok(self.config()?.recent)
    }

    pub fn create(&mut self, path: &Path, name: String) -> Result<VaultRecord, CoreError> {
        if name.trim().is_empty() {
            return Err(storage_error("vault name is empty"));
        }
        fs_guard::require_local_absolute(path)?;
        let internal = path.join(".fossil");
        fs_guard::reject_link(&internal)?;
        fs::create_dir_all(&internal).map_err(storage_error)?;
        // Exclusive reservation: creating twice must never overwrite an existing vault.
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(internal.join("fossil.db"))
            .map_err(storage_error)?;
        drop(file);
        fs::write(
            internal.join("vault.json"),
            serde_json::to_vec(&name).map_err(storage_error)?,
        )
        .map_err(storage_error)?;
        self.open(path)
    }

    pub fn open(&mut self, path: &Path) -> Result<VaultRecord, CoreError> {
        // Checked before canonicalize: resolving a network path already connects to it.
        fs_guard::require_local_absolute(path)?;
        let path = dunce::canonicalize(path).map_err(storage_error)?;
        fs_guard::require_local_absolute(&path)?;
        for internal in [".fossil", ".fossil/fossil.db", ".fossil/vault.json"] {
            fs_guard::reject_link(&path.join(internal))?;
        }
        let db = path.join(".fossil/fossil.db");
        if !db.is_file() {
            return Err(storage_error("vault database does not exist"));
        }
        let connection = open_vault(
            db.to_str()
                .ok_or_else(|| storage_error("invalid vault path"))?,
        )?;
        let name_path = path.join(".fossil/vault.json");
        let name = match fs::read(name_path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(storage_error)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => path
                .file_name()
                .ok_or_else(|| storage_error("vault name unavailable"))?
                .to_string_lossy()
                .into_owned(),
            Err(error) => return Err(storage_error(error)),
        };
        let vault = VaultRecord {
            path: path.to_string_lossy().into_owned(),
            name,
        };
        let mut config = self.config()?;
        config.recent.retain(|item| item.path != vault.path);
        config.recent.insert(0, vault.clone());
        let parent = self
            .config
            .parent()
            .ok_or_else(|| storage_error("invalid config path"))?;
        fs::create_dir_all(parent).map_err(storage_error)?;
        let temporary = parent.join(format!("config-{}.tmp", ulid::Ulid::generate()));
        fs::write(
            &temporary,
            serde_json::to_vec_pretty(&config).map_err(storage_error)?,
        )
        .map_err(storage_error)?;
        if let Err(error) = fs::rename(&temporary, &self.config) {
            let _ = fs::remove_file(temporary);
            return Err(storage_error(error));
        }
        // Failed opens/config writes preserve the previous active connection.
        self.connection = Some(connection);
        self.root = Some(path.clone());
        Ok(vault)
    }

    /// Folder of the open vault, if any.
    pub fn root(&self) -> Option<&Path> {
        self.root.as_deref()
    }

    pub fn with_connection<T>(
        &mut self,
        operation: impl FnOnce(&mut Connection) -> Result<T, CoreError>,
    ) -> Result<T, CoreError> {
        operation(self.connection.as_mut().ok_or(CoreError::VaultNotOpen)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        object_store,
        objects::{NewObject, TypeKey},
    };

    #[test]
    fn creates_reopens_and_deduplicates_recent_vaults_without_losing_objects() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("AppData/Fossil/config.json");
        let path = dir.path().join("Bóveda 🚀");
        let mut session = VaultSession::new(config.clone());
        assert!(session.recent().unwrap().is_empty());
        assert_eq!(
            session.with_connection(|_| Ok(())).unwrap_err(),
            CoreError::VaultNotOpen
        );
        let first = session.create(&path, "Acme".into()).unwrap();
        // Recent paths are shown in the UI: no Windows verbatim prefix.
        assert!(!first.path.starts_with(r"\\?\"), "{}", first.path);
        let object = session
            .with_connection(|conn| {
                object_store::create(
                    conn,
                    NewObject {
                        types: vec![TypeKey::Page],
                        title: "Nota".into(),
                        icon: None,
                        parent: None,
                    },
                )
            })
            .unwrap();
        assert!(session.create(&path, "Overwrite".into()).is_err());
        let second = session
            .create(&dir.path().join("Otra"), "Otra".into())
            .unwrap();
        session.open(&path).unwrap();
        assert_eq!(session.recent().unwrap(), vec![first.clone(), second]);
        drop(session);
        let mut session = VaultSession::new(config);
        assert_eq!(session.open(&path).unwrap(), first);
        assert_eq!(
            session
                .with_connection(|conn| object_store::get(conn, &object.id))
                .unwrap(),
            Some(object)
        );
    }

    #[test]
    fn failed_open_preserves_active_vault_and_corrupt_config_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config.json");
        let mut session = VaultSession::new(config.clone());
        let path = dir.path().join("vault");
        let vault = session.create(&path, "Vault".into()).unwrap();
        assert!(session.open(dir.path()).is_err());
        assert!(!dir.path().join(".fossil").exists());
        assert_eq!(session.recent().unwrap(), vec![vault]);
        fs::write(&config, "broken").unwrap();
        assert!(session.open(&path).is_err());
        assert_eq!(fs::read_to_string(config).unwrap(), "broken");
        assert!(session.with_connection(|_| Ok(())).is_ok());
    }

    #[test]
    fn refuses_relative_network_and_device_paths() {
        let dir = tempfile::tempdir().unwrap();
        let mut session = VaultSession::new(dir.path().join("config.json"));
        let mut paths = vec!["relative-vault".to_string()];
        if cfg!(windows) {
            paths.extend(
                [
                    r"\\127.0.0.1\fossil-test\vault",
                    r"\\?\UNC\127.0.0.1\x",
                    r"\\.\NUL",
                ]
                .map(String::from),
            );
        }
        for path in paths {
            assert!(
                session.create(Path::new(&path), "X".into()).is_err(),
                "{path}"
            );
            assert!(session.open(Path::new(&path)).is_err(), "{path}");
        }
        assert!(!Path::new("relative-vault").exists(), "nothing created");
        assert!(session.recent().unwrap().is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn refuses_a_vault_whose_internal_folder_is_a_link() {
        let dir = tempfile::tempdir().unwrap();
        let mut session = VaultSession::new(dir.path().join("config.json"));
        let real = dir.path().join("real");
        session.create(&real, "Real".into()).unwrap();
        let planted = dir.path().join("planted");
        fs::create_dir(&planted).unwrap();
        crate::fs_guard::tests::make_junction(&planted.join(".fossil"), &real.join(".fossil"));
        assert!(session.open(&planted).is_err());
    }
}
