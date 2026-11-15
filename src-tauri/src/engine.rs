// Runs the engine's jobs for the window: making a video, the downloads, AI and connector setup, planning, the queue, the
// release check and export. The engine is Studio's own copy of Node.js running engine\engine.mjs (installed), or `node
// src/engine/main.ts` from the repository (development). Only the named jobs below can be started; each one's settings go
// as one JSON argument, and a key for a hosted AI service is written to the engine's standard input, never put on its
// command line. Every line the engine says is passed to the window as an "engine" event, and the run is stopped (with
// everything it started, such as the practice program or the helper) on Cancel or when the window closes.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

/// The jobs the window may start (src/engine/main.ts has the same list).
const JOBS: &[&str] = &[
    "status", "library", "make-video", "get-voice", "get-ai", "set-ai", "test-ai", "plan-series", "series-plan",
    "series-choose", "write-series", "rehearse-series", "queue", "release-check", "export", "set-connector",
    "connector-lines", "set-settings", "start-blocklist",
];

#[derive(Default)]
pub struct Runs {
    next: AtomicU32,
    children: Mutex<HashMap<u32, u32>>,
}

/// No console window for the engine or anything it starts.
#[cfg(windows)]
fn quiet(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000)
}
#[cfg(not(windows))]
fn quiet(cmd: &mut Command) -> &mut Command {
    cmd
}

/// The repository's folder, for a build run from it: found by walking up from Studio's own program.
fn repository() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors().find(|p| p.join("src").join("engine").join("main.ts").is_file()).map(Path::to_path_buf)
}

/// How to start the engine: the installed copy if it is there, otherwise the repository's.
fn engine_command(app: &AppHandle) -> Result<(Command, bool), String> {
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let node = resources.join("node").join("node.exe");
    let bundle = resources.join("engine").join("engine.mjs");
    if node.is_file() && bundle.is_file() {
        // Plain paths: given Windows' long-path form (\\?\C:\...), the engine would not know it is the program being run.
        let mut cmd = Command::new(plain(&node));
        cmd.arg(plain(&bundle)).env("OPENSTAGE_STUDIO_RESOURCES", plain(&resources));
        return Ok((cmd, true));
    }
    let repo = repository().ok_or("Studio's engine was not found. Reinstall OpenStage Studio.")?;
    let mut cmd = Command::new("node");
    cmd.arg(repo.join("src").join("engine").join("main.ts")).current_dir(&repo);
    Ok((cmd, false))
}

/// A path written plainly, without Windows' long-path prefix.
fn plain(p: &Path) -> String {
    p.to_string_lossy().trim_start_matches(r"\\?\").to_string()
}

#[tauri::command]
pub fn run_engine(app: AppHandle, runs: State<'_, Runs>, job: String, args: serde_json::Value, secret: Option<String>) -> Result<u32, String> {
    if !JOBS.contains(&job.as_str()) {
        return Err(format!("\"{job}\" is not one of the engine's jobs."));
    }
    if !args.is_object() {
        return Err("The job's settings must be a JSON object.".into());
    }
    let (mut cmd, _installed) = engine_command(&app)?;
    if let Ok(exe) = std::env::current_exe() {
        cmd.env("OPENSTAGE_STUDIO_EXE", plain(&exe));
    }
    if let Ok(docs) = app.path().document_dir() {
        cmd.env("OPENSTAGE_STUDIO_DOCUMENTS", plain(&docs));
    }
    cmd.arg(&job).arg(args.to_string()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child: Child = quiet(&mut cmd).spawn().map_err(|e| format!("The engine could not start: {e}"))?;
    let run = runs.next.fetch_add(1, Ordering::SeqCst) + 1;
    // The key, if any, then end of input.
    if let Some(mut input) = child.stdin.take() {
        if let Some(s) = secret {
            let _ = input.write_all(s.as_bytes());
        }
    }
    runs.children.lock().unwrap().insert(run, child.id());
    let out = child.stdout.take().unwrap();
    let err = child.stderr.take().unwrap();
    let app_err = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(err).lines().map_while(Result::ok) {
            let _ = app_err.emit("engine", serde_json::json!({ "run": run, "type": "log", "text": line }));
        }
    });
    std::thread::spawn(move || {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            let event = match serde_json::from_str::<serde_json::Value>(&line) {
                Ok(serde_json::Value::Object(mut o)) => {
                    o.insert("run".into(), run.into());
                    serde_json::Value::Object(o)
                }
                _ => serde_json::json!({ "run": run, "type": "log", "text": line }),
            };
            let _ = app.emit("engine", event);
        }
        let code = child.wait().ok().and_then(|s| s.code());
        app.state::<Runs>().children.lock().unwrap().remove(&run);
        let _ = app.emit("engine", serde_json::json!({ "run": run, "type": "ended", "code": code }));
    });
    Ok(run)
}

/// Stop a run and everything it started. What a download already fetched is kept; it carries on next time.
fn stop(pid: u32) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
    let _ = quiet(&mut cmd).status();
}

#[tauri::command]
pub fn cancel_engine(runs: State<'_, Runs>, run: u32) -> bool {
    let pid = runs.children.lock().unwrap().get(&run).copied();
    match pid {
        Some(pid) => {
            stop(pid);
            true
        }
        None => false,
    }
}

/// Stop every run (the window is closing).
pub fn stop_all(app: &AppHandle) {
    let pids: Vec<u32> = app.state::<Runs>().children.lock().unwrap().values().copied().collect();
    for pid in pids {
        stop(pid);
    }
}

/// The person's work folder, as src/paths.ts finds it: the repository for a build run from it; installed, the folder chosen
/// in Settings (kept in %APPDATA%\org.openstage.studio\studio.json) or Documents\OpenStage Studio.
fn workspace(app: &AppHandle) -> Option<PathBuf> {
    let resources = app.path().resource_dir().ok()?;
    if !resources.join("engine").join("engine.mjs").is_file() {
        return repository();
    }
    let chosen = app
        .path()
        .config_dir()
        .ok()
        .map(|d| d.join("org.openstage.studio").join("studio.json"))
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str::<serde_json::Value>(t.trim_start_matches('\u{feff}')).ok())
        .and_then(|v| v["workspace"].as_str().map(PathBuf::from));
    chosen.or_else(|| app.path().document_dir().ok().map(|d| d.join("OpenStage Studio")))
}

/// Let the window read and write the person's work folder (to review videos made there and export their packages).
#[tauri::command]
pub fn allow_workspace(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_fs::FsExt;
    let w = workspace(&app).ok_or("The work folder could not be found.")?;
    std::fs::create_dir_all(&w).map_err(|e| e.to_string())?;
    app.fs_scope().allow_directory(&w, true).map_err(|e| e.to_string())?;
    Ok(plain(&w))
}
