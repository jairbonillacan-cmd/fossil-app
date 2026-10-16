//! OS integration and quick-capture IPC contract (#28): global shortcut
//! configuration, floating capture window control and direct append to today's
//! journal or a chosen object (`r1-shell-ux` §Captura rápida).

use super::objects::{VaultState, changed, with_session};
use fossil_core::capture;
use fossil_core::ids::ObjectId;
use fossil_core::objects::{CoreError, ObjectMeta};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex, sync::PoisonError};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tauri_specta::Event;

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

pub const CAPTURE_WINDOW_LABEL: &str = "capture";
const DEFAULT_SHORTCUT: &str = "Win+Shift+F";
pub struct CaptureShortcut(pub Mutex<(String, bool)>);

fn win_err(e: impl std::fmt::Display) -> OsError {
    OsError::Window(e.to_string())
}
fn cap_win(app: &AppHandle) -> Result<WebviewWindow, OsError> {
    app.get_webview_window(CAPTURE_WINDOW_LABEL)
        .ok_or_else(|| win_err("missing"))
}
fn cfg_file(app: &AppHandle, name: &str) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(name))
}
fn read_cfg(app: &AppHandle, name: &str) -> Option<String> {
    fs::read_to_string(cfg_file(app, name)?).ok()
}
fn norm_win(s: &str) -> String {
    s.trim().replace("Super+", "Win+").replace("super+", "Win+")
}
fn parse_shortcut(s: &str) -> Result<Shortcut, OsError> {
    let raw = norm_win(s).replace("Win+", "Super+");
    Shortcut::try_from(raw.as_str()).map_err(|e| OsError::ShortcutInvalid(e.to_string()))
}
fn tray_labels(lang: &str) -> [String; 3] {
    let raw = if lang.trim().starts_with("en") {
        include_str!("../../../src/i18n/en.json")
    } else {
        include_str!("../../../src/i18n/es-MX.json")
    };
    let v: serde_json::Value = serde_json::from_str(raw).unwrap_or_default();
    ["trayOpen", "trayNew", "trayQuit"].map(|k| v["capture"][k].as_str().unwrap_or(k).into())
}
fn register(app: &AppHandle, accelerator: &str) -> Result<(), OsError> {
    let shortcut = parse_shortcut(accelerator)?;
    if !app.global_shortcut().is_registered(shortcut) {
        app.global_shortcut()
            .register(shortcut)
            .map_err(|e| OsError::ShortcutConflict(e.to_string()))?;
    }
    Ok(())
}

pub fn setup(app: &AppHandle) {
    let acc = read_cfg(app, "capture-shortcut.txt")
        .filter(|s| parse_shortcut(s).is_ok())
        .map_or_else(|| DEFAULT_SHORTCUT.into(), |s| norm_win(&s));
    let ok = register(app, &acc).is_ok();
    app.manage(CaptureShortcut(Mutex::new((acc, ok))));
    let lang = read_cfg(app, "language.txt").unwrap_or_default();
    let [o, c, q] = tray_labels(&lang);
    let item = |id, txt: &str| MenuItem::with_id(app, id, txt, true, None::<&str>);
    if let (Ok(open), Ok(cap), Ok(quit)) = (item("open", &o), item("cap", &c), item("quit", &q))
        && let Ok(menu) = Menu::with_items(app, &[&open, &cap, &quit])
    {
        let mut tray = TrayIconBuilder::new()
            .tooltip("Fossil")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, ev| match ev.id.as_ref() {
                "open" => crate::focus_main_window(app),
                "cap" => drop(show_capture_window(app)),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|t, ev| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = ev
                {
                    crate::focus_main_window(t.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon().cloned() {
            tray = tray.icon(icon);
        }
        let _ = tray.build(app);
    }
}

pub fn show_capture_window(app: &AppHandle) -> Result<(), OsError> {
    let w = cap_win(app)?;
    let _ = w.center();
    w.show().and_then(|()| w.set_focus()).map_err(win_err)?;
    let ev = CaptureRequested { target_id: None };
    ev.emit(app).map_err(win_err)
}

/// Returns the currently configured global capture shortcut (defaults to `"Super+Shift+F"`).
#[tauri::command]
#[specta::specta]
pub fn capture_shortcut_get(state: tauri::State<'_, CaptureShortcut>) -> Result<String, OsError> {
    let g = state.0.lock().unwrap_or_else(PoisonError::into_inner);
    let s = g.0.clone();
    g.1.then(|| s.clone()).ok_or(OsError::ShortcutConflict(s))
}

/// Validates, registers with the OS and persists the global quick-capture shortcut.
#[tauri::command]
#[specta::specta]
pub fn capture_shortcut_set(
    app: AppHandle,
    state: tauri::State<'_, CaptureShortcut>,
    shortcut: String,
) -> Result<String, OsError> {
    let acc = norm_win(&shortcut);
    let next = parse_shortcut(&acc)?;
    let mut cur = state.0.lock().unwrap_or_else(PoisonError::into_inner);
    let prev = parse_shortcut(&cur.0).ok();
    register(&app, &acc)?;
    if let Some(p) = cfg_file(&app, "capture-shortcut.txt") {
        let _ = p.parent().map(fs::create_dir_all);
        fs::write(p, &acc).map_err(win_err)?;
    }
    if let Some(p) = prev.filter(|p| *p != next) {
        let _ = app.global_shortcut().unregister(p);
    }
    *cur = (acc.clone(), true);
    Ok(acc)
}

/// Shows and focuses the floating quick-capture mini-window (`< 300 ms`).
#[tauri::command]
#[specta::specta]
pub fn capture_window_show(app: AppHandle) -> Result<(), OsError> {
    show_capture_window(&app)
}

/// Hides the floating quick-capture mini-window after saving or pressing `Escape`.
#[tauri::command]
#[specta::specta]
pub fn capture_window_hide(app: AppHandle) -> Result<(), OsError> {
    cap_win(&app)?.hide().map_err(win_err)
}

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

    #[test]
    fn capture_requested_event_has_contract_name_and_serializes() {
        assert_eq!(CaptureRequested::NAME, "capture:requested");
        let payload = CaptureRequested { target_id: None };
        let value = serde_json::to_value(payload).unwrap();
        assert!(value.get("target_id").is_some());
    }

    #[test]
    fn parses_shortcuts_and_loads_localized_tray_labels() {
        let f = parse_shortcut;
        assert_eq!(f(" Super+Shift+F "), f(DEFAULT_SHORTCUT));
        assert!(f("Ctrl+Alt+K").is_ok());
        for bad in ["", "Shift+", "Ctrl+Nope", "F+G"] {
            assert!(f(bad).is_err());
        }
        assert_eq!(tray_labels("es")[0], "Abrir Fossil");
        assert_eq!(tray_labels("en"), ["Open Fossil", "New capture", "Quit"]);
    }
}
