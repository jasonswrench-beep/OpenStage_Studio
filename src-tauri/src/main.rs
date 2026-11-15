// OpenStage Studio's shell. Started plainly it opens the Studio window. Started with `--sample-program` it opens only the
// practice program (Practice Planner, an invented program used for tests and examples), full screen on one display, at a
// fixed layout size, so a take always looks the same.
//
// Demo mode is off unless `--demo-hook <endpoint> --demo-token <token>` are given; then the practice program's page is
// told where the player listens (this computer only), and its demo-mode hook starts.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn value_after(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

/// The hook's settings, if they are safe to hand to the page: an address on this computer and a plain token.
fn hook_settings(args: &[String]) -> Option<(String, String)> {
    let endpoint = value_after(args, "--demo-hook")?;
    let token = value_after(args, "--demo-token")?;
    let local = ["http://127.0.0.1:", "http://localhost:", "http://[::1]:"].iter().any(|p| endpoint.starts_with(p));
    let plain = token.len() >= 16 && token.len() <= 128 && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if local && plain {
        Some((endpoint, token))
    } else {
        eprintln!("The demo-mode settings were refused: the hook only talks to this computer, with a plain token.");
        None
    }
}

/// Display number `n`: 1 is the main display, 2 the first other one, and so on. The main display if there is no such one.
fn pick_monitor(window: &tauri::WebviewWindow, n: usize) -> tauri::Result<Option<tauri::Monitor>> {
    let monitors = window.available_monitors()?;
    let primary = window.primary_monitor()?;
    if n <= 1 {
        return Ok(primary.or_else(|| monitors.first().cloned()));
    }
    let others: Vec<_> = monitors.iter().filter(|m| primary.as_ref().map(|p| p.name() != m.name()).unwrap_or(true)).cloned().collect();
    Ok(others.get(n - 2).cloned().or(primary))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let sample = args.iter().any(|a| a == "--sample-program");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(engine::Runs::default())
        .invoke_handler(tauri::generate_handler![engine::run_engine, engine::cancel_engine, engine::allow_workspace])
        .setup(move |app| {
            if !sample {
                let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("OpenStage Studio")
                    .inner_size(1180.0, 860.0)
                    .min_inner_size(720.0, 520.0);
                // `--review <folder>`: open that video's review. The window may read that folder, and write the one
                // script named in its review (to add a blurred box), and nothing else unless the person chooses it.
                if let Some(folder) = value_after(&args, "--review") {
                    // The full path, written plainly (without Windows' long-path prefix), as the page will ask for it.
                    let full = std::fs::canonicalize(&folder).unwrap_or_else(|_| std::path::PathBuf::from(&folder));
                    let folder = std::path::PathBuf::from(full.to_string_lossy().trim_start_matches(r"\\?\").to_string());
                    let review = folder.join("review.json");
                    if review.is_file() {
                        use tauri_plugin_fs::FsExt;
                        app.fs_scope().allow_directory(&folder, true)?;
                        let script = std::fs::read_to_string(&review)
                            .ok()
                            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                            .and_then(|v| v["script"].as_str().map(String::from));
                        if let Some(script) = script {
                            app.fs_scope().allow_file(&script)?;
                        }
                        let path = folder.to_string_lossy().to_string();
                        builder = builder.initialization_script(format!("window.__OPENSTAGE_REVIEW__ = {};", serde_json::json!(path)));
                    } else {
                        eprintln!("{} has no review.json, so it was not opened for review.", folder.display());
                    }
                }
                let window = builder.build()?;
                // `--monitor <n>` puts the window on that display (used when testing, so the main display stays free).
                if let Some(n) = value_after(&args, "--monitor").and_then(|v| v.parse::<usize>().ok()) {
                    if let Some(m) = pick_monitor(&window, n)? {
                        let p = m.position();
                        window.set_position(tauri::PhysicalPosition::new(p.x + 40, p.y + 40))?;
                    }
                }
                return Ok(());
            }
            // The practice program, full screen on the chosen display (1 is the main one).
            let monitor_number: usize = value_after(&args, "--monitor").and_then(|v| v.parse().ok()).unwrap_or(1).max(1);
            // How wide the page is laid out, in CSS pixels; the window's real width is shared out over it, so the
            // program's text is a readable size in the video whatever the display's own scale.
            let layout_width: f64 = value_after(&args, "--layout-width").and_then(|v| v.parse().ok()).unwrap_or(1280.0);
            let mut builder = WebviewWindowBuilder::new(app, "sample", WebviewUrl::App("sample.html".into()))
                .title("Practice Planner (OpenStage Studio sample program)")
                .decorations(false)
                .resizable(false)
                .visible(false);
            // Its own browser-engine data folder: the engine is started with the take's settings (grey text smoothing,
            // src/pipeline/programs.ts), and it refuses to share a data folder with Studio's own window, which runs with the
            // engine's ordinary settings, so a take started from the window would get a blank program.
            if let Ok(local) = app.path().app_local_data_dir() {
                builder = builder.data_directory(local.join("practice-program"));
            }
            let hooked = hook_settings(&args);
            if let Some((endpoint, token)) = &hooked {
                let settings = serde_json::json!({ "endpoint": endpoint, "token": token });
                builder = builder.initialization_script(format!("window.__OPENSTAGE_DEMO_HOOK__ = {settings};"));
            }
            // Driven without the hook (the accessibility driver): the window never takes the keyboard, so typing meant for
            // another program cannot land in it during a take. The driver works its controls without the focus.
            let plain = hooked.is_none() && value_after(&args, "--open-demo").is_some();
            if plain {
                builder = builder.focused(false).focusable(false);
            }
            // `--sample-version <n>`: run as that version of the practice program (2 renames two controls, for the
            // release check). A plain whole number only.
            if let Some(version) = value_after(&args, "--sample-version").and_then(|v| v.parse::<u32>().ok()).filter(|v| (1..=99).contains(v)) {
                builder = builder.initialization_script(format!("window.__PRACTICE_PLANNER_VERSION__ = {version};"));
            }
            // `--open-demo <name>`: open that demo project at start (for the accessibility driver, which has no hook to ask
            // for one). Only a plain demo name: lower case letters, digits and hyphens.
            if let Some(demo) = value_after(&args, "--open-demo").filter(|d| !d.is_empty() && d.len() <= 63 && d.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')) {
                builder = builder.initialization_script(format!("window.__PRACTICE_PLANNER_OPEN__ = {};", serde_json::json!(demo)));
            }
            let window = builder.build()?;
            if let Some(m) = pick_monitor(&window, monitor_number)? {
                window.set_position(*m.position())?;
                window.set_size(*m.size())?;
                let zoom = m.size().width as f64 / (m.scale_factor() * layout_width);
                window.set_zoom(zoom)?;
            }
            window.set_fullscreen(true)?;
            window.show()?;
            if !plain {
                window.set_focus()?;
            }
            let _ = app.get_webview_window("sample");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("OpenStage Studio could not start")
        .run(|app, event| {
            // Closing the window stops any job still running, with everything it started.
            if let tauri::RunEvent::Exit = event {
                engine::stop_all(app);
            }
        });
}
