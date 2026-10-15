use std::path::PathBuf;

fn main() {
    // tauri-build's manifest only reaches the app binary; test binaries then
    // crash on startup with 0xc0000139 (comctl32 v5 lacks TaskDialogIndirect,
    // tauri-apps/tauri#13419). Embed our own manifest into every binary instead.
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());

    if let Err(error) = tauri_build::try_build(attributes) {
        eprintln!("tauri_build failed: {error}");
        std::process::exit(1);
    }

    if let Some(manifest_dir) = std::env::var_os("CARGO_MANIFEST_DIR") {
        let manifest = PathBuf::from(manifest_dir).join("windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        println!("cargo:rerun-if-changed={}", manifest.display());
    }
}
