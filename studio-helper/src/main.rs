// SPDX-License-Identifier: Apache-2.0
//! studio-helper: the part of OpenStage Studio that needs Windows itself.
//!
//! It has no window. OpenStage Studio starts it with one of these words and reads what it says, one JSON object per line:
//!
//! * `windows`: the windows that can be recorded.
//! * `take --window <title>`: watch one window and save a still picture of it whenever asked (`{"cmd":"grab"}` on
//!   standard input), once the window has stopped changing.
//! * `voices`: the voices Windows can speak with.
//! * `speak --jobs <file>`: turn lines of narration into sound files, with Kokoro (a local speech model) or a Windows voice.
//! * `phonemes --text <words>`: how Kokoro will say some words, to check a pronunciation.
//! * `assemble --plan <file> --out <video>`: lay the pictures, pointer, callouts, cards and narration onto a timeline
//!   and write the finished MP4.
//! * `compare --a <video> --b <video>`: say whether two finished videos show and sound the same.
//! * `ocr --jobs <file>`: read the text in still pictures, for the frame scan.
//! * `thumbnail --plan <file> --out <png>`: draw a video's thumbnail.
//! * `awake`: keep the computer and its screen awake until standard input is closed (for unattended runs).
//! * `uia`: the accessibility driver: find and work a window's controls as a screen reader does.
//! * `slides --plan <file>`: draw a lecture's slides as still pictures.
//! * `recording --project <folder>`: what a recording in the shared capture format holds (its takes and their logs).
//!
//! The capture engine (Windows Graphics Capture, the MP4 writer, the drawing on frames) and the capture format's reader are
//! the OpenStage shared core's (tag `capture-v0.1.0`), used without change.

mod assemble;
mod awake;
mod compare;
mod kokoro;
mod ocr;
mod pointer;
mod pngio;
mod recording;
mod slides;
mod speech;
mod take;
mod thumbnail;
mod uia;
mod wav;

use std::process::ExitCode;

/// Print one JSON object on its own line, and make sure it leaves at once.
pub fn say(value: serde_json::Value) {
    use std::io::Write;
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

/// The value after `--name`, if given.
pub fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(command) = args.first().map(String::as_str) else {
        eprintln!("Say what to do: windows, take, voices, speak, assemble, compare, ocr or thumbnail.");
        return ExitCode::from(2);
    };
    let result = match command {
        "windows" => take::list_windows(),
        "take" => take::run(&args),
        "voices" => speech::list_voices(),
        "speak" => speech::run(&args),
        "phonemes" => speech::phonemes(&args),
        "assemble" => assemble::run(&args),
        "compare" => compare::run(&args),
        "ocr" => ocr::run(&args),
        "awake" => awake::run(),
        "uia" => uia::run(),
        "thumbnail" => thumbnail::run(&args),
        "recording" => recording::run(&args),
        "slides" => slides::run(&args),
        other => Err(format!("\"{other}\" is not something this helper does. Use windows, take, voices, speak, assemble, compare, ocr or thumbnail.")),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            say(serde_json::json!({ "event": "error", "message": message }));
            eprintln!("{message}");
            ExitCode::from(1)
        }
    }
}
