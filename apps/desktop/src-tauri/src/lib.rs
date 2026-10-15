use tauri::Manager;

mod commands;

pub const MAIN_WINDOW_LABEL: &str = "main";

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    use commands::ai::{AiEvent, ai_cancel, ai_chat, ai_providers, ai_routes_get, ai_routes_set};
    use commands::objects::{
        IndexUpdated, ObjectChanged, attachment_load, attachment_save, journal_today,
        links_backlinks, links_unlinked_mentions, object_apply_update, object_archive,
        object_create, object_export_markdown, object_get, object_list, object_load_doc,
        object_update_meta, vault_create, vault_open, vault_recent,
    };
    use commands::search::search_query;

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
            object_load_doc,
            object_apply_update,
            object_export_markdown,
            links_backlinks,
            links_unlinked_mentions,
            journal_today,
            attachment_save,
            attachment_load,
            search_query,
            ai_providers,
            ai_chat,
            ai_cancel,
            ai_routes_get,
            ai_routes_set,
        ])
        .events(tauri_specta::collect_events![
            ObjectChanged,
            IndexUpdated,
            AiEvent
        ])
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

    tauri::Builder::default()
        .invoke_handler(specta.invoke_handler())
        .setup(move |app| {
            specta.mount_events(app);
            app.manage(commands::objects::VaultState(std::sync::Mutex::new(
                fossil_core::vault::VaultSession::installation()?,
            )));
            app.manage(commands::objects::IdleCompaction::default());
            app.manage(commands::objects::MirrorDebounce::default());
            // The single-instance plugin must be registered first (upstream requirement).
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                        focus_main_window(app)
                    }))?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_window_state::Builder::default().build())
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
