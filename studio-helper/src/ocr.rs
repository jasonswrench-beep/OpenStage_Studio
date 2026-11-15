// SPDX-License-Identifier: Apache-2.0
//! Reading the text in still pictures, for the frame scan, with Windows' own text recognition (part of Windows; nothing to
//! download or licence).
//!
//! `ocr --jobs <file>`: the jobs file lists pictures (`{"pictures":[{"id":"...","file":"..."}],"out":"..."}`). Every
//! picture is read, and the lines and words found, with where they are in pixels of the picture, are written to `out`.
//! The pictures are enlarged before reading, because the text in a program's window is small for text recognition.

use crate::{arg, pngio::read_png, say};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize)]
struct Jobs {
    pictures: Vec<Picture>,
    out: PathBuf,
    /// The language to read, such as en-US. The first of this computer's languages that Windows can read if left out.
    language: Option<String>,
}

#[derive(Deserialize)]
struct Picture {
    id: String,
    file: PathBuf,
}

/// Enlarge a picture by a whole number, smoothly (each new pixel is a blend of the four nearest).
fn enlarge(w: u32, h: u32, bgra: &[u8], by: u32) -> (u32, u32, Vec<u8>) {
    if by <= 1 {
        return (w, h, bgra.to_vec());
    }
    let (nw, nh) = (w * by, h * by);
    let mut out = vec![0u8; (nw * nh * 4) as usize];
    let at = |x: u32, y: u32, c: usize| bgra[((y * w + x) * 4) as usize + c] as f32;
    for y in 0..nh {
        let fy = ((y as f32 + 0.5) / by as f32 - 0.5).max(0.0);
        let (y0, ty) = (fy.floor() as u32, fy - fy.floor());
        let y1 = (y0 + 1).min(h - 1);
        for x in 0..nw {
            let fx = ((x as f32 + 0.5) / by as f32 - 0.5).max(0.0);
            let (x0, tx) = (fx.floor() as u32, fx - fx.floor());
            let x1 = (x0 + 1).min(w - 1);
            let i = ((y * nw + x) * 4) as usize;
            for c in 0..4 {
                let top = at(x0, y0, c) * (1.0 - tx) + at(x1, y0, c) * tx;
                let bottom = at(x0, y1, c) * (1.0 - tx) + at(x1, y1, c) * tx;
                out[i + c] = (top * (1.0 - ty) + bottom * ty).round() as u8;
            }
        }
    }
    (nw, nh, out)
}

#[cfg(windows)]
pub fn run(args: &[String]) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    let file = arg(args, "--jobs").ok_or("Say which jobs file to read, with --jobs.")?;
    let jobs: Jobs = serde_json::from_slice(&std::fs::read(&file).map_err(|e| format!("Could not read {file}: {e}"))?)
        .map_err(|e| format!("The jobs file {file} is not right: {e}"))?;

    let make_engine = || {
        match &jobs.language {
            Some(tag) => {
                let language = Language::CreateLanguage(&HSTRING::from(tag)).map_err(|e| format!("\"{tag}\" is not a language: {e}"))?;
                OcrEngine::TryCreateFromLanguage(&language)
            }
            None => OcrEngine::TryCreateFromUserProfileLanguages(),
        }
        .map_err(|_| "Windows' text recognition is not installed for this language. Add the language's optical character recognition in Windows Settings (Time and language, Language and region).".to_string())
    };
    let engine = make_engine()?;
    let language = engine.RecognizerLanguage().and_then(|l| l.LanguageTag()).map(|t| t.to_string()).unwrap_or_default();
    let largest = OcrEngine::MaxImageDimension().unwrap_or(2600);
    say(serde_json::json!({ "event": "reader", "language": language, "largest": largest }));

    // Several pictures are read at once, each reader on its own thread. What is found does not depend on the order.
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).clamp(1, 6);
    let next = std::sync::atomic::AtomicUsize::new(0);
    let done = std::sync::atomic::AtomicUsize::new(0);
    let results: std::sync::Mutex<Vec<Option<serde_json::Value>>> = std::sync::Mutex::new(vec![None; jobs.pictures.len()]);
    let read_one = |engine: &OcrEngine, picture: &Picture| -> Result<serde_json::Value, String> {
        let (w, h, bgra) = read_png(&picture.file)?;
        // Enlarge as far as the reader allows, up to three times: small text is read far more reliably when larger.
        let by = (1..=3).rev().find(|k| w * k <= largest && h * k <= largest).unwrap_or(1);
        let (bw, bh, big) = enlarge(w, h, &bgra, by);
        let writer = DataWriter::new().map_err(|e| e.to_string())?;
        writer.WriteBytes(&big).map_err(|e| e.to_string())?;
        let buffer = writer.DetachBuffer().map_err(|e| e.to_string())?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, bw as i32, bh as i32)
            .map_err(|e| format!("Could not hand {} to the reader: {e}", picture.file.display()))?;
        let result = engine
            .RecognizeAsync(&bitmap)
            .and_then(|op| op.join())
            .map_err(|e| format!("Could not read the text in {}: {e}", picture.file.display()))?;
        let scale = by as f32;
        let mut lines = Vec::new();
        for line in result.Lines().map_err(|e| e.to_string())? {
            let mut words = Vec::new();
            let (mut l, mut t, mut r, mut b) = (f32::MAX, f32::MAX, 0f32, 0f32);
            for word in line.Words().map_err(|e| e.to_string())? {
                let rect = word.BoundingRect().map_err(|e| e.to_string())?;
                let (x, y, ww, wh) = (rect.X / scale, rect.Y / scale, rect.Width / scale, rect.Height / scale);
                l = l.min(x);
                t = t.min(y);
                r = r.max(x + ww);
                b = b.max(y + wh);
                words.push(serde_json::json!({ "text": word.Text().map_err(|e| e.to_string())?.to_string(), "rect": [x.round(), y.round(), ww.round(), wh.round()] }));
            }
            if words.is_empty() {
                continue;
            }
            lines.push(serde_json::json!({
                "text": line.Text().map_err(|e| e.to_string())?.to_string(),
                "rect": [l.round(), t.round(), (r - l).round(), (b - t).round()],
                "words": words,
            }));
        }
        Ok(serde_json::Value::Array(lines))
    };
    std::thread::scope(|scope| -> Result<(), String> {
        let workers: Vec<_> = (0..threads)
            .map(|_| {
                scope.spawn(|| -> Result<(), String> {
                    let engine = make_engine()?;
                    loop {
                        let i = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        let Some(picture) = jobs.pictures.get(i) else { return Ok(()) };
                        let lines = read_one(&engine, picture)?;
                        results.lock().map_err(|_| "A reader failed.".to_string())?[i] = Some(lines);
                        let n = done.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                        say(serde_json::json!({ "event": "progress", "done": n, "of": jobs.pictures.len() }));
                    }
                })
            })
            .collect();
        for w in workers {
            w.join().map_err(|_| "A reader stopped unexpectedly.".to_string())??;
        }
        Ok(())
    })?;
    let mut found = serde_json::Map::new();
    for (picture, lines) in jobs.pictures.iter().zip(results.into_inner().map_err(|_| "A reader failed.".to_string())?) {
        found.insert(picture.id.clone(), lines.unwrap_or(serde_json::Value::Array(vec![])));
    }
    std::fs::write(&jobs.out, serde_json::to_vec(&serde_json::json!({ "language": language, "pictures": found })).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Could not save {}: {e}", jobs.out.display()))?;
    say(serde_json::json!({ "event": "read", "pictures": jobs.pictures.len(), "language": language }));
    Ok(())
}

#[cfg(not(windows))]
pub fn run(_args: &[String]) -> Result<(), String> {
    Err("Reading text in pictures needs Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::enlarge;

    #[test]
    fn enlarging_keeps_flat_colour_and_doubles_the_size() {
        let px = [10u8, 20, 30, 255].repeat(4);
        let (w, h, out) = enlarge(2, 2, &px, 2);
        assert_eq!((w, h), (4, 4));
        assert!(out.chunks_exact(4).all(|p| p == [10, 20, 30, 255]));
    }
}
