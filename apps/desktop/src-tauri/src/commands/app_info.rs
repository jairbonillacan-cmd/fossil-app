use serde::Serialize;

/// Basic information about the running app, exposed to the UI via typed IPC.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
}

impl AppInfo {
    fn new(version: String, data_dir: std::path::PathBuf) -> Self {
        Self {
            version,
            data_dir: data_dir.display().to_string(),
        }
    }
}

#[derive(Debug, Clone, thiserror::Error, Serialize, specta::Type)]
pub enum AppInfoError {
    #[error("the app data directory is unavailable")]
    DataDirUnavailable,
}

#[tauri::command]
#[specta::specta]
pub fn app_info(app: tauri::AppHandle) -> Result<AppInfo, AppInfoError> {
    use tauri::Manager;

    let version = app.package_info().version.to_string();
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppInfoError::DataDirUnavailable)?;
    Ok(AppInfo::new(version, data_dir))
}

#[cfg(test)]
mod tests {
    use super::AppInfo;

    #[test]
    fn formats_data_dir_as_string() {
        let info = AppInfo::new("0.0.1".into(), std::path::PathBuf::from(r"C:\Data\Fossil"));
        assert_eq!(info.version, "0.0.1");
        assert_eq!(info.data_dir, r"C:\Data\Fossil");
    }

    #[test]
    fn serializes_with_snake_case_fields() {
        let info = AppInfo::new("0.0.1".into(), std::path::PathBuf::from("/data"));
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["version"], "0.0.1");
        assert_eq!(json["data_dir"], "/data");
    }
}
