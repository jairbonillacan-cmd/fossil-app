//! OS integration and quick-capture IPC contract (#28): global shortcut
//! configuration, floating capture window control and direct append to today's
//! journal or a chosen object (`r1-shell-ux` §Captura rápida).

use super::objects::{VaultState, changed, with_session};
use fossil_core::capture;
use fossil_core::ids::ObjectId;
use fossil_core::objects::{CoreError, ObjectMeta};
use serde::{Deserialize, Serialize};

/// Payload for appending a quick-capture note to today's journal or a chosen object.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct QuickCaptureInput {
    /// Plain text or inline markdown to append as a block at the end of the target document.
    pub text: String,
    /// Optional target object ID; when `None`, appends to today's journal (`journal_today`).
    pub target_id: Option<ObjectId>,
}

/// Typed errors for OS shortcut and quick-capture window commands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type, thiserror::Error)]
pub enum OsError {
    #[error("not implemented yet")]
    NotImplemented,
    #[error("invalid shortcut accelerator: {0}")]
    ShortcutInvalid(String),
    #[error("shortcut could not be registered: {0}")]
    ShortcutConflict(String),
    #[error("window operation failed: {0}")]
    Window(String),
}

/// Emitted when the global shortcut or system tray requests opening/focusing the capture input.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "capture:requested")]
pub struct CaptureRequested {
    pub target_id: Option<ObjectId>,
}

macro_rules! stub {
    ($(#[$meta:meta])* $vis:vis fn $name:ident($($arg:ident: $ty:ty),*) -> $ret:ty) => {
        $(#[$meta])*
        #[tauri::command]
        #[specta::specta]
        #[allow(unused_variables)] // contract stubs: bodies arrive with #9
        $vis fn $name($($arg: $ty),*) -> $ret {
            Err(OsError::NotImplemented)
        }
    };
}

stub!(/// Returns the currently configured global capture shortcut (defaults to `"Super+Shift+F"`).
    pub fn capture_shortcut_get() -> Result<String, OsError>);

stub!(/// Validates, registers with the OS and persists the global quick-capture shortcut.
    pub fn capture_shortcut_set(shortcut: String) -> Result<String, OsError>);

stub!(/// Shows and focuses the floating quick-capture mini-window (`< 300 ms`).
    pub fn capture_window_show() -> Result<(), OsError>);

stub!(/// Hides the floating quick-capture mini-window after saving or pressing `Escape`.
    pub fn capture_window_hide() -> Result<(), OsError>);

/// Appends `input.text` as paragraph block(s) to today's journal (creating it
/// if needed) or to `input.target_id`, schedules the `.md` mirror and re-index,
/// and emits `object:changed`.
#[tauri::command]
#[specta::specta]
pub fn capture_append(
    state: tauri::State<'_, VaultState>,
    app: tauri::AppHandle,
    input: QuickCaptureInput,
) -> Result<ObjectMeta, CoreError> {
    let meta = with_session(state, |session| {
        session.with_connection(|conn| capture::append(conn, input.target_id.as_ref(), &input.text))
    })?;
    Ok(changed(&app, meta))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_specta::Event;

    #[test]
    fn capture_requested_event_has_contract_name_and_serializes() {
        assert_eq!(CaptureRequested::NAME, "capture:requested");
        let payload = CaptureRequested { target_id: None };
        let value = serde_json::to_value(payload).unwrap();
        assert!(value.get("target_id").is_some());
    }

    #[test]
    fn shortcut_and_window_stubs_return_not_implemented() {
        assert_eq!(capture_shortcut_get().unwrap_err(), OsError::NotImplemented);
        assert_eq!(
            capture_shortcut_set("Super+Shift+F".into()).unwrap_err(),
            OsError::NotImplemented
        );
        assert_eq!(capture_window_show().unwrap_err(), OsError::NotImplemented);
        assert_eq!(capture_window_hide().unwrap_err(), OsError::NotImplemented);
    }
}
