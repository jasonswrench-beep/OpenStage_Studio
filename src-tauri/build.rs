fn main() {
    // Studio's own commands (the engine's) are listed so each needs a permission: only the main window's capability grants
    // them (capabilities/default.json), so the practice program's window cannot start a job.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["run_engine", "cancel_engine", "allow_workspace"])),
    )
    .expect("the shell's build settings could not be read");
}
