use tauri::Manager;

mod commands;

pub const MAIN_WINDOW_LABEL: &str = "main";

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = (window.show(), window.unminimize(), window.set_focus());
    }
}

fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    use commands::ai::{AiEvent, ai_cancel, ai_chat, ai_providers, ai_routes_get, ai_routes_set};
    use commands::objects::{
        IndexUpdated, ObjectChanged, attachment_load, attachment_save, journal_today,
        links_backlinks, links_broken, links_inbound_count, links_unlinked_mentions,
        object_apply_update, object_archive, object_create, object_export_markdown, object_get,
        object_list, object_load_doc, object_move, object_rename, object_update_meta, vault_create,
        vault_open, vault_recent,
    };
    use commands::os::{
        CaptureRequested, capture_append, capture_shortcut_get, capture_shortcut_set,
        capture_window_hide, capture_window_show,
    };
    use commands::search::{
        search_filters_delete, search_filters_list, search_filters_save, search_query,
    };
    use commands::snapshots::{
        mirror_roundtrip_verify, page_version_diff, page_version_list, page_version_restore,
        snapshot_create, snapshot_list, snapshot_restore_attachment, snapshot_restore_page,
        snapshot_restore_workspace,
    };

    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            commands::app_info::app_info,
            vault_open,
            vault_create,
            vault_recent,
            object_create,
            object_get,
            object_list,
            object_update_meta,
            object_archive,
            object_move,
            object_load_doc,
            object_apply_update,
            object_export_markdown,
            links_backlinks,
            links_unlinked_mentions,
            object_rename,
            links_inbound_count,
            links_broken,
            journal_today,
            attachment_save,
            attachment_load,
            search_query,
            search_filters_list,
            search_filters_save,
            search_filters_delete,
            ai_providers,
            ai_chat,
            ai_cancel,
            ai_routes_get,
            ai_routes_set,
            capture_shortcut_get,
            capture_shortcut_set,
            capture_window_show,
            capture_window_hide,
            capture_append,
            snapshot_create,
            snapshot_list,
            snapshot_restore_workspace,
            snapshot_restore_page,
            snapshot_restore_attachment,
            page_version_list,
            page_version_diff,
            page_version_restore,
            mirror_roundtrip_verify,
        ])
        .events(tauri_specta::collect_events![
            ObjectChanged,
            IndexUpdated,
            AiEvent,
            CaptureRequested
        ])
        // Used by the TS transport batcher, not by any command (r1-save-chaos).
        .typ::<fossil_core::snapshots::SaveStatus>()
}

fn build_app() -> tauri::Builder<tauri::Wry> {
    let specta = specta_builder();

    // Regenerate bindings on debug builds (also runs from unit tests).
    #[cfg(debug_assertions)]
    {
        let bindings = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/bindings.ts");
        if let Err(error) = specta.export(specta_typescript::Typescript::default(), &bindings) {
            eprintln!("failed to export bindings.ts: {error}");
            std::process::exit(1);
        }
    }

    let builder = tauri::Builder::default();
    // The single-instance plugin must be registered first (upstream requirement).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        focus_main_window(app)
    }));

    builder
        .invoke_handler(specta.invoke_handler())
        .setup(move |app| {
            specta.mount_events(app);
            app.manage(commands::objects::VaultState(std::sync::Mutex::new(
                fossil_core::vault::VaultSession::installation()?,
            )));
            app.manage(commands::objects::IdleCompaction::default());
            app.manage(commands::objects::MirrorDebounce::default());
            commands::os::setup(app.handle());
            Ok(())
        })
        .on_window_event(|win, ev| {
            if win.label() == MAIN_WINDOW_LABEL
                && let tauri::WindowEvent::CloseRequested { api, .. } = ev
            {
                api.prevent_close();
                let _ = win.hide();
            }
        })
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _sc, ev| {
                    if ev.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = commands::os::show_capture_window(app);
                    }
                })
                .build(),
        )
        .plugin({
            use tauri_plugin_window_state::{Builder, StateFlags};
            Builder::default()
                .with_denylist(&[commands::os::CAPTURE_WINDOW_LABEL])
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build()
        })
        .plugin(tauri_plugin_dialog::init())
}

pub fn run() -> tauri::Result<()> {
    build_app().run(tauri::generate_context!())
}

#[cfg(test)]
mod tests {
    use super::build_app;

    #[test]
    fn app_builder_wires_plugins_without_panicking() {
        let _builder = build_app();
    }
}
