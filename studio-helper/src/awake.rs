// SPDX-License-Identifier: Apache-2.0
//! `awake`: keep the computer and its screen awake while an unattended run records, then let them sleep again.
//!
//! Studio starts this and leaves its standard input open; when Studio closes it (or stops), the helper says Windows may
//! sleep again and ends. A screen that turned off would stop the window pictures a take needs.

use crate::say;

#[cfg(windows)]
pub fn run() -> Result<(), String> {
    use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED};
    let before = unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED) };
    if before.0 == 0 {
        return Err("Windows did not agree to keep the computer awake.".into());
    }
    say(serde_json::json!({ "event": "awake" }));
    // Wait until Studio closes standard input.
    let mut sink = String::new();
    while std::io::stdin().read_line(&mut sink).map(|n| n > 0).unwrap_or(false) {
        sink.clear();
    }
    unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
    say(serde_json::json!({ "event": "asleep-allowed" }));
    Ok(())
}

#[cfg(not(windows))]
pub fn run() -> Result<(), String> {
    Err("Keeping the computer awake needs Windows.".into())
}
