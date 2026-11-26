// SPDX-License-Identifier: Apache-2.0
//! The take: watch one program window with the capture engine and keep a still picture of it whenever the player asks.
//!
//! The player performs a step, the program redraws, and the player asks for a picture. The picture is saved once the
//! window has stopped changing for a moment (`settleMs`), so it shows the finished result of the step and never a
//! half-drawn one. Because the video's timing comes from the narration and not from the clock during the take, the same
//! script gives the same pictures every time, however fast or slow the computer was.
//!
//! With `--film screen` it films the whole display the window is on instead of the window alone, for a program that hides its
//! window or shows windows of its own around it during a step (OpenStage Capture hides itself while it captures another program).
//! Such a program fills that display, so a place on its page is the same place in the picture.
//!
//! Commands, one JSON object a line on standard input:
//! `{"cmd":"grab","dir":"<folder>","settleMs":250,"timeoutMs":5000}`, `{"cmd":"shown"}` and `{"cmd":"stop"}`.
//! Answers: `{"event":"ready",...}`, `{"event":"grabbed","file":"<folder>/<fingerprint>.png","hash":...,"shown":true}` and
//! `{"event":"shown","shown":true}`, where `shown` says whether the program's window is showing (not hidden or minimized).

use crate::{arg, pngio, say};
use openstage_capture_windows::{choose_window, system_platform, FittedSource, Frame, FrameSource};
use serde_json::json;
use std::io::BufRead;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub fn list_windows() -> Result<(), String> {
    let platform = system_platform();
    let windows = platform.list_windows().map_err(|e| e.to_string())?;
    let list: Vec<_> = windows
        .iter()
        .map(|w| json!({ "number": w.number, "title": w.title, "process": w.process, "width": w.width, "height": w.height }))
        .collect();
    say(json!({ "event": "windows", "windows": list }));
    Ok(())
}

struct Latest {
    frame: Option<Frame>,
    /// When the latest picture arrived.
    at: Option<Instant>,
    /// How many pictures have arrived.
    count: u64,
}

pub fn run(args: &[String]) -> Result<(), String> {
    let wanted = arg(args, "--window").ok_or("Say which window to watch with --window and part of its title.")?;
    let width: u32 = arg(args, "--width").and_then(|v| v.parse().ok()).unwrap_or(1920);
    let height: u32 = arg(args, "--height").and_then(|v| v.parse().ok()).unwrap_or(1080);
    let wait_s: u64 = arg(args, "--wait").and_then(|v| v.parse().ok()).unwrap_or(20);
    let film_screen = match arg(args, "--film").as_deref() {
        None | Some("window") => false,
        Some("screen") => true,
        Some(other) => return Err(format!("--film is window or screen, not \"{other}\".")),
    };

    // The program may still be starting, so look for its window for a while.
    let platform = system_platform();
    let started = Instant::now();
    let window = loop {
        let windows = platform.list_windows().map_err(|e| e.to_string())?;
        match choose_window(&windows, &wanted) {
            Ok(w) => break w.clone(),
            Err(why) if started.elapsed() > Duration::from_secs(wait_s) => return Err(why),
            Err(_) => std::thread::sleep(Duration::from_millis(250)),
        }
    };
    let (source, display) = if film_screen {
        let display = display_of(&platform.list_displays().map_err(|e| e.to_string())?, window.handle)
            .ok_or_else(|| format!("Could not tell which display the window \"{}\" is on.", window.title))?;
        (platform.start_display_capture(&display, false).map_err(|e| e.to_string())?, Some(display))
    } else {
        (platform.start_window_capture(&window, false).map_err(|e| e.to_string())?, None)
    };
    let mut source: Box<dyn FrameSource + Send> = Box::new(SendSource(Box::new(FittedSource::new(source, width, height))));
    let handle = window.handle;

    let latest = Arc::new(Mutex::new(Latest { frame: None, at: None, count: 0 }));
    let stop = Arc::new(AtomicBool::new(false));
    let ended = Arc::new(Mutex::new(None::<String>));
    let watcher = {
        let (latest, stop, ended) = (latest.clone(), stop.clone(), ended.clone());
        std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                if let Some(frame) = source.next_frame(Duration::from_millis(50)) {
                    let mut l = latest.lock().unwrap();
                    l.frame = Some(frame);
                    l.at = Some(Instant::now());
                    l.count += 1;
                } else if let Some(why) = source.ended() {
                    *ended.lock().unwrap() = Some(why);
                    break;
                }
            }
        })
    };

    // Wait for the first picture.
    let first_deadline = Instant::now() + Duration::from_secs(10);
    while latest.lock().unwrap().frame.is_none() {
        if Instant::now() > first_deadline {
            stop.store(true, Ordering::SeqCst);
            return Err(format!("No picture came from the window \"{}\" within 10 seconds.", window.title));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    say(json!({ "event": "ready", "window": window.title, "process": window.process, "width": width, "height": height,
        "windowWidth": window.width, "windowHeight": window.height, "film": if film_screen { "screen" } else { "window" },
        "display": display.as_ref().map(|d| json!([d.x, d.y, d.width, d.height])) }));

    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let cmd: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                say(json!({ "event": "error", "message": format!("That command is not JSON: {e}") }));
                continue;
            }
        };
        if let Some(why) = ended.lock().unwrap().clone() {
            say(json!({ "event": "error", "message": why }));
            break;
        }
        match cmd["cmd"].as_str() {
            Some("grab") => {
                let dir = PathBuf::from(cmd["dir"].as_str().unwrap_or("."));
                let settle = Duration::from_millis(cmd["settleMs"].as_u64().unwrap_or(250));
                let timeout = Duration::from_millis(cmd["timeoutMs"].as_u64().unwrap_or(5000));
                match grab(&latest, &dir, settle, timeout) {
                    Ok(mut answer) => {
                        answer["shown"] = json!(shown(handle));
                        say(answer)
                    }
                    Err(message) => say(json!({ "event": "error", "message": message })),
                }
            }
            Some("shown") => say(json!({ "event": "shown", "shown": shown(handle) })),
            Some("stop") => break,
            other => say(json!({ "event": "error", "message": format!("Unknown command {other:?}.") })),
        }
    }
    stop.store(true, Ordering::SeqCst);
    // Give the watching thread a moment to finish, but never wait on Windows' capture service to wind down: the
    // pictures are all saved, so the helper says so and ends at once.
    let deadline = Instant::now() + Duration::from_millis(1000);
    while !watcher.is_finished() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    say(json!({ "event": "stopped" }));
    std::process::exit(0)
}

/// Wait until no new picture has come for `settle` (counted from when the command came, or from the latest picture,
/// whichever is later), then save the latest picture under its fingerprint.
fn grab(latest: &Arc<Mutex<Latest>>, dir: &std::path::Path, settle: Duration, timeout: Duration) -> Result<serde_json::Value, String> {
    let asked = Instant::now();
    let count_before = latest.lock().unwrap().count;
    let mut settled = true;
    loop {
        let last = latest.lock().unwrap().at.unwrap_or(asked);
        let quiet_since = last.max(asked);
        if quiet_since.elapsed() >= settle {
            break;
        }
        if asked.elapsed() >= timeout {
            settled = false;
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let l = latest.lock().unwrap();
    let frame = l.frame.as_ref().ok_or("There is no picture yet.")?;
    let hash = pngio::fingerprint(&frame.bgra);
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not make the folder {}: {e}", dir.display()))?;
    let file = dir.join(format!("{hash}.png"));
    if !file.exists() {
        pngio::write_png(&file, frame.width, frame.height, &frame.bgra)?;
    }
    Ok(json!({ "event": "grabbed", "file": file.to_string_lossy(), "hash": hash, "settled": settled,
        "waitedMs": asked.elapsed().as_millis() as u64, "newPictures": l.count - count_before }))
}

/// The display that holds the middle of the window, or the one it overlaps most if its middle is on none.
fn display_of(displays: &[openstage_capture_windows::DisplayInfo], handle: isize) -> Option<openstage_capture_windows::DisplayInfo> {
    let (left, top, right, bottom) = window_rect(handle)?;
    let (cx, cy) = ((left + right) / 2, (top + bottom) / 2);
    let inside = |d: &openstage_capture_windows::DisplayInfo| cx >= d.x && cx < d.x + d.width as i32 && cy >= d.y && cy < d.y + d.height as i32;
    if let Some(d) = displays.iter().find(|d| inside(d)) {
        return Some(d.clone());
    }
    let overlap = |d: &openstage_capture_windows::DisplayInfo| {
        let w = (right.min(d.x + d.width as i32) - left.max(d.x)).max(0) as i64;
        let h = (bottom.min(d.y + d.height as i32) - top.max(d.y)).max(0) as i64;
        w * h
    };
    displays.iter().max_by_key(|d| overlap(d)).filter(|d| overlap(d) > 0).cloned()
}

#[cfg(windows)]
fn window_rect(handle: isize) -> Option<(i32, i32, i32, i32)> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let mut r = RECT::default();
    unsafe { GetWindowRect(HWND(handle as *mut core::ffi::c_void), &mut r) }.ok()?;
    Some((r.left, r.top, r.right, r.bottom))
}

#[cfg(not(windows))]
fn window_rect(_: isize) -> Option<(i32, i32, i32, i32)> {
    None
}

/// Whether the window is showing: not hidden, not minimized, and not closed.
#[cfg(windows)]
fn shown(handle: isize) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{IsIconic, IsWindow, IsWindowVisible};
    let h = HWND(handle as *mut core::ffi::c_void);
    unsafe { IsWindow(Some(h)).as_bool() && IsWindowVisible(h).as_bool() && !IsIconic(h).as_bool() }
}

#[cfg(not(windows))]
fn shown(_: isize) -> bool {
    true
}

/// The capture source is only ever used from the one thread that takes pictures from it.
struct SendSource(Box<dyn FrameSource>);
// SAFETY: the source is moved to the watching thread once and only used there.
unsafe impl Send for SendSource {}
impl FrameSource for SendSource {
    fn next_frame(&mut self, timeout: Duration) -> Option<Frame> {
        self.0.next_frame(timeout)
    }
    fn dropped(&self) -> u64 {
        self.0.dropped()
    }
    fn recycle(&mut self, frame: Frame) {
        self.0.recycle(frame)
    }
    fn ended(&self) -> Option<String> {
        self.0.ended()
    }
}
