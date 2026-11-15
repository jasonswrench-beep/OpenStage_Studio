// OpenStage Studio's shell. Started plainly it opens the Studio window. Started with `--sample-program` it opens only the
// practice program (Practice Planner, an invented program used for tests and examples), full screen on one display, at a
// fixed layout size, so a take always looks the same.
//
// Demo mode is off unless `--demo-hook <endpoint> --demo-token <token>` are given; then the practice program's page is
// told where the player listens (this computer only), and its demo-mode hook starts.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let sample = args.iter().any(|a| a == "--sample-program");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(move |app| {
            if !sample {
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("OpenStage Studio")
                    .inner_size(1180.0, 800.0)
                    .min_inner_size(720.0, 520.0)
                    .build()?;
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
            if let Some((endpoint, token)) = hook_settings(&args) {
                let settings = serde_json::json!({ "endpoint": endpoint, "token": token });
                builder = builder.initialization_script(format!("window.__OPENSTAGE_DEMO_HOOK__ = {settings};"));
            }
            let window = builder.build()?;
            let monitors = window.available_monitors()?;
            let primary = window.primary_monitor()?;
            let monitor = if monitor_number == 1 {
                primary.or_else(|| monitors.first().cloned())
            } else {
                let others: Vec<_> = monitors
                    .iter()
                    .filter(|m| primary.as_ref().map(|p| p.name() != m.name()).unwrap_or(true))
                    .cloned()
                    .collect();
                others.get(monitor_number - 2).cloned().or(primary)
            };
            if let Some(m) = monitor {
                window.set_position(*m.position())?;
                window.set_size(*m.size())?;
                let zoom = m.size().width as f64 / (m.scale_factor() * layout_width);
                window.set_zoom(zoom)?;
            }
            window.set_fullscreen(true)?;
            window.show()?;
            window.set_focus()?;
            let _ = app.get_webview_window("sample");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("OpenStage Studio could not start");
}
