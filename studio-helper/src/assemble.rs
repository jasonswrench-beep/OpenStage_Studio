// SPDX-License-Identifier: Apache-2.0
//! Assembly: turn a timeline plan into the finished MP4.
//!
//! The plan is written by OpenStage Studio's timeline builder (TypeScript). It says, for every frame, which still picture
//! of the take or which card is shown, where the pointer is, when a click circle shows, which callouts are drawn, and when
//! each narration clip starts. This file only draws and encodes: every decision about timing was made before, so the same
//! plan always gives the same frames and the same sound.
//!
//! Drawing uses the capture engine's canvas and Windows' text; the MP4 is written by the engine's video sink (H.264 and
//! AAC through Windows' own encoders).

use crate::{arg, pngio, pointer, say, wav};
use openstage_capture_project::EditAlign;
use openstage_capture_render::{Canvas, PixelRect, Rgb, TextRenderer, TextRequest};
use openstage_capture_windows::{system_video_platform, AudioSpec, Frame, SinkSpec};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    #[serde(default = "default_bitrate")]
    pub bitrate_kbps: u32,
    pub frames: u64,
    #[serde(default)]
    pub pictures: HashMap<String, String>,
    pub segments: Vec<Segment>,
    /// The pointer's tip for each frame, or nothing when it is not shown.
    #[serde(default)]
    pub pointer: Vec<Option<[f32; 2]>>,
    #[serde(default = "default_scale")]
    pub pointer_scale: f32,
    #[serde(default)]
    pub clicks: Vec<Click>,
    #[serde(default)]
    pub marks: Vec<Mark>,
    #[serde(default)]
    pub audio: Option<Audio>,
    /// Blurred boxes, chosen in review: each hides part of the picture for a run of frames.
    #[serde(default)]
    pub redactions: Vec<RedactionSpan>,
}

/// A blurred box over the picture from one frame to another. The box is in pixels of a 1920 by 1080 frame and is scaled to
/// the plan's size.
#[derive(Deserialize)]
pub struct RedactionSpan {
    pub from: u64,
    pub to: u64,
    #[serde(rename = "box")]
    pub rect: [i32; 4],
}

fn default_bitrate() -> u32 {
    10_000
}
fn default_scale() -> f32 {
    2.0
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub from: u64,
    pub to: u64,
    #[serde(default)]
    pub picture: Option<String>,
    #[serde(default)]
    pub card: Option<Card>,
    /// Frames over which this segment fades in from the one before.
    #[serde(default)]
    pub fade_in: u64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    #[serde(default)]
    pub kicker: String,
    pub title: String,
    #[serde(default)]
    pub lines: Vec<String>,
    #[serde(default = "navy")]
    pub background: String,
    #[serde(default = "pink")]
    pub accent: String,
    #[serde(default = "white")]
    pub color: String,
}

fn navy() -> String {
    "#102037".into()
}
fn pink() -> String {
    "#FF7BCC".into()
}
fn white() -> String {
    "#FFFFFF".into()
}

#[derive(Deserialize)]
pub struct Click {
    pub frame: u64,
    pub x: f32,
    pub y: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    /// `box`, `arrow`, `label` or `key`.
    pub kind: String,
    pub from: u64,
    pub to: u64,
    #[serde(default)]
    pub rect: Option<[i32; 4]>,
    #[serde(default)]
    pub start: Option<[f32; 2]>,
    #[serde(default)]
    pub end: Option<[f32; 2]>,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub font_px: Option<f32>,
    #[serde(default)]
    pub line: Option<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Audio {
    #[serde(default = "rate48")]
    pub sample_rate: u32,
    pub clips: Vec<AudioClip>,
}

fn rate48() -> u32 {
    48_000
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioClip {
    pub file: String,
    pub start_ms: u64,
    #[serde(default = "one")]
    pub gain: f32,
}

fn one() -> f32 {
    1.0
}

fn colour(text: &Option<String>, fallback: Rgb) -> Rgb {
    text.as_deref().and_then(|t| Rgb::parse(t).ok()).unwrap_or(fallback)
}

pub fn run(args: &[String]) -> Result<(), String> {
    let plan_path = arg(args, "--plan").ok_or("Say where the plan is with --plan.")?;
    let out = PathBuf::from(arg(args, "--out").ok_or("Say where the video goes with --out.")?);
    let text = std::fs::read_to_string(&plan_path).map_err(|e| format!("Could not read {plan_path}: {e}"))?;
    let plan: Plan = serde_json::from_str(&text).map_err(|e| format!("The plan in {plan_path} is not right: {e}"))?;
    let base = Path::new(&plan_path).parent().unwrap_or(Path::new(".")).to_path_buf();
    assemble(&plan, &base, &out)
}

/// The text drawing: Windows' own on Windows.
fn text_renderer() -> Box<dyn TextRenderer> {
    #[cfg(windows)]
    {
        Box::new(openstage_capture_windows::WindowsText)
    }
    #[cfg(not(windows))]
    {
        struct NoText;
        impl TextRenderer for NoText {
            fn draw(&self, _: &mut Canvas, _: &TextRequest) -> Result<openstage_capture_render::TextFit, String> {
                Err("Text is drawn only on Windows.".into())
            }
        }
        Box::new(NoText)
    }
}

fn check_plan(plan: &Plan) -> Result<(), String> {
    if plan.width == 0 || plan.height == 0 || plan.fps == 0 || plan.frames == 0 {
        return Err("The plan needs a size, a frame rate and at least one frame.".into());
    }
    if plan.width % 2 == 1 || plan.height % 2 == 1 {
        return Err("The video's width and height must be even numbers.".into());
    }
    if !plan.pointer.is_empty() && plan.pointer.len() as u64 != plan.frames {
        return Err(format!("The plan has {} pointer places for {} frames.", plan.pointer.len(), plan.frames));
    }
    let mut next = 0;
    for s in &plan.segments {
        if s.from != next || s.to <= s.from {
            return Err(format!("The plan's pieces must follow one another without gaps (one starts at frame {}, expected {next}).", s.from));
        }
        if s.picture.is_none() == s.card.is_none() {
            return Err(format!("The piece at frame {} must show either a picture or a card.", s.from));
        }
        if let Some(p) = &s.picture {
            if !plan.pictures.contains_key(p) {
                return Err(format!("The piece at frame {} shows the picture \"{p}\", which the plan does not list.", s.from));
            }
        }
        next = s.to;
    }
    if next != plan.frames {
        return Err(format!("The plan's pieces end at frame {next}, but the video has {} frames.", plan.frames));
    }
    Ok(())
}

pub fn assemble(plan: &Plan, base: &Path, out: &Path) -> Result<(), String> {
    check_plan(plan)?;
    let (w, h) = (plan.width, plan.height);
    let text = text_renderer();

    // Every picture of the take, read once and fitted to the frame.
    let mut pictures: HashMap<&str, Canvas> = HashMap::new();
    for (id, file) in &plan.pictures {
        let path = resolve(base, file);
        let (pw, ph, bgra) = pngio::read_png(&path)?;
        let mut canvas = Canvas::new(w, h);
        if pw == w && ph == h {
            canvas.bgra.copy_from_slice(&bgra);
            canvas.bgra.chunks_exact_mut(4).for_each(|p| p[3] = 255);
        } else {
            let pic = openstage_capture_render::Picture::new(pw, ph, bgra);
            let scale = (w as f64 / pw as f64).min(h as f64 / ph as f64);
            let (dw, dh) = ((pw as f64 * scale) as i32, (ph as f64 * scale) as i32);
            canvas.draw_picture(
                &pic,
                openstage_capture_render::SourceRect { x: 0.0, y: 0.0, w: pw as f64, h: ph as f64 },
                PixelRect::new((w as i32 - dw) / 2, (h as i32 - dh) / 2, dw, dh),
            );
        }
        pictures.insert(id.as_str(), canvas);
    }
    // Every card, drawn once.
    let mut cards: Vec<Option<Canvas>> = Vec::new();
    for s in &plan.segments {
        cards.push(match &s.card {
            Some(card) => Some(draw_card(card, w, h, text.as_ref())?),
            None => None,
        });
    }
    let mut warnings: Vec<String> = Vec::new();
    for m in &plan.marks {
        if let (Some(rect), Some(seg)) = (m.rect, plan.segments.iter().find(|s| s.from <= m.from && m.from < s.to)) {
            if let Some(pic) = seg.picture.as_ref().and_then(|p| pictures.get(p.as_str())) {
                let c = colour(&m.color, Rgb(224, 24, 45));
                let ratio = contrast(c, average_around(pic, rect));
                if ratio < 3.0 && m.kind == "box" {
                    warnings.push(format!(
                        "The callout at frame {} has a contrast of {:.1} to 1 against the picture behind it (3 to 1 is suggested). It is kept as it is.",
                        m.from, ratio
                    ));
                }
            }
        }
    }
    for wmsg in &warnings {
        say(json!({ "event": "warning", "message": wmsg }));
    }

    // The sound: every clip at its place, mixed into one stereo track.
    let sound = match &plan.audio {
        Some(audio) => Some(mix_audio(audio, base, plan.frames, plan.fps)?),
        None => None,
    };

    let platform = system_video_platform();
    platform.start_media().map_err(|e| e.to_string())?;
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    }
    // Windows chooses the kind of file from its extension, so the unfinished file must still end in .mp4.
    let part = out.with_extension("part.mp4");
    let _ = std::fs::remove_file(&part);
    let spec = SinkSpec {
        path: part.clone(),
        width: w,
        height: h,
        fps: plan.fps,
        bitrate_kbps: plan.bitrate_kbps,
        fragmented: false,
        audio: sound.as_ref().map(|_| AudioSpec { sample_rate: 48_000, channels: 2, bitrate_kbps: 192 }),
    };
    let mut sink = platform.create_sink(&spec).map_err(|e| e.to_string())?;
    if let Some(note) = sink.note() {
        say(json!({ "event": "note", "message": note }));
    }

    let samples_per_frame = 48_000 / plan.fps as usize; // 1600 at 30 frames a second
    let mut canvas = Canvas::new(w, h);
    let mut digest: u64 = 0xcbf2_9ce4_8422_2325;
    for i in 0..plan.frames {
        let si = plan.segments.iter().position(|s| s.from <= i && i < s.to).unwrap();
        let seg = &plan.segments[si];
        let base_of = |k: usize| -> &Canvas {
            let s = &plan.segments[k];
            match &s.picture {
                Some(p) => &pictures[p.as_str()],
                None => cards[k].as_ref().unwrap(),
            }
        };
        canvas.bgra.copy_from_slice(&base_of(si).bgra);
        if seg.fade_in > 0 && si > 0 && i - seg.from < seg.fade_in {
            let share = ((i - seg.from + 1) * 255 / (seg.fade_in + 1)) as u32;
            mix_into(&mut canvas, base_of(si - 1), 255 - share);
        }
        for r in plan.redactions.iter().filter(|r| r.from <= i && i < r.to) {
            blur_box(&mut canvas, r.rect, w as f32 / 1920.0);
        }
        for m in plan.marks.iter().filter(|m| m.from <= i && i < m.to) {
            draw_mark(&mut canvas, m, text.as_ref())?;
        }
        let ms_per_frame = 1000.0 / plan.fps as f64;
        for c in plan.clicks.iter().filter(|c| c.frame <= i) {
            let age = ((i - c.frame) as f64 * ms_per_frame) as u64;
            pointer::draw_click(&mut canvas, c.x, c.y, age, plan.pointer_scale);
        }
        if let Some(Some([x, y])) = plan.pointer.get(i as usize) {
            pointer::draw_pointer(&mut canvas, *x, *y, plan.pointer_scale);
        }
        for p in canvas.bgra.iter() {
            digest ^= *p as u64;
            digest = digest.wrapping_mul(0x0100_0000_01b3);
        }

        let pts = (i as i64 * 10_000_000) / plan.fps as i64;
        let next = ((i + 1) as i64 * 10_000_000) / plan.fps as i64;
        if let Some(sound) = &sound {
            let from = i as usize * samples_per_frame * 2;
            let chunk = &sound[from..from + samples_per_frame * 2];
            sink.write_audio(chunk, pts).map_err(|e| e.to_string())?;
        }
        let frame = Frame { width: w, height: h, t_ms: (i * 1000) / plan.fps as u64, captured_100ns: None, arrived_100ns: None, bgra: canvas.bgra.clone() };
        sink.write(&frame, pts, next - pts).map_err(|e| e.to_string())?;
        if i % 30 == 0 || i + 1 == plan.frames {
            say(json!({ "event": "progress", "frame": i + 1, "frames": plan.frames }));
        }
    }
    sink.finish().map_err(|e| e.to_string())?;
    std::fs::rename(&part, out).map_err(|e| format!("Could not save {}: {e}", out.display()))?;
    say(json!({ "event": "assembled", "out": out.to_string_lossy(), "frames": plan.frames,
        "durationMs": plan.frames * 1000 / plan.fps as u64, "frameDigest": format!("{digest:016x}"),
        "soundDigest": sound.as_ref().map(|s| digest_i16(s)), "warnings": warnings }));
    Ok(())
}

fn resolve(base: &Path, file: &str) -> PathBuf {
    let p = Path::new(file);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        base.join(p)
    }
}

fn digest_i16(samples: &[i16]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for s in samples {
        for b in s.to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    }
    format!("{h:016x}")
}

/// Lay `under` beneath `canvas` with `share` (0 to 255) of it showing: a cross-fade.
fn mix_into(canvas: &mut Canvas, under: &Canvas, share: u32) {
    for (a, b) in canvas.bgra.iter_mut().zip(under.bgra.iter()) {
        *a = ((*a as u32 * (255 - share) + *b as u32 * share + 127) / 255) as u8;
    }
}

/// The loudest point of each narration clip: about 3 decibels under full scale.
const NARRATION_PEAK: f32 = 0.708;

fn mix_audio(audio: &Audio, base: &Path, frames: u64, fps: u32) -> Result<Vec<i16>, String> {
    if audio.sample_rate != 48_000 {
        return Err("The video's sound is made at 48,000 samples a second.".into());
    }
    let total = (frames as usize) * (48_000 / fps as usize);
    let mut mix = vec![0f32; total];
    for clip in &audio.clips {
        let mono = wav::read_wav(&resolve(base, &clip.file))?;
        let samples = wav::resample(&mono, 48_000);
        // Every clip is brought to the same peak level, a little under full scale, so the voice is even from line to
        // line and never clips.
        let peak = samples.iter().fold(0f32, |m, s| m.max(s.abs()));
        let level = if peak > 1e-4 { NARRATION_PEAK / peak } else { 1.0 };
        let start = (clip.start_ms as usize) * 48;
        for (k, s) in samples.iter().enumerate() {
            if let Some(slot) = mix.get_mut(start + k) {
                *slot += s * level * clip.gain;
            }
        }
    }
    let mut stereo = Vec::with_capacity(total * 2);
    for s in mix {
        let v = (s * 32767.0).round().clamp(-32768.0, 32767.0) as i16;
        stereo.push(v);
        stereo.push(v);
    }
    Ok(stereo)
}

fn luminance(c: Rgb) -> f64 {
    let f = |v: u8| {
        let s = v as f64 / 255.0;
        if s <= 0.03928 {
            s / 12.92
        } else {
            ((s + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * f(c.0) + 0.7152 * f(c.1) + 0.0722 * f(c.2)
}

/// The contrast ratio of two colours, as the documentation tool's contrast check computes it (WCAG).
pub fn contrast(a: Rgb, b: Rgb) -> f64 {
    let (la, lb) = (luminance(a), luminance(b));
    (la.max(lb) + 0.05) / (la.min(lb) + 0.05)
}

/// The average colour of a band just outside `rect` in `pic`.
fn average_around(pic: &Canvas, rect: [i32; 4]) -> Rgb {
    let [x, y, rw, rh] = rect;
    let (mut r, mut g, mut b, mut n) = (0u64, 0u64, 0u64, 0u64);
    let band = 8;
    for py in (y - band).max(0)..(y + rh + band).min(pic.height as i32) {
        for px in (x - band).max(0)..(x + rw + band).min(pic.width as i32) {
            let inside = px >= x && px < x + rw && py >= y && py < y + rh;
            if inside {
                continue;
            }
            let c = pic.pixel(px as u32, py as u32);
            r += c.0 as u64;
            g += c.1 as u64;
            b += c.2 as u64;
            n += 1;
        }
    }
    if n == 0 {
        return Rgb(255, 255, 255);
    }
    Rgb((r / n) as u8, (g / n) as u8, (b / n) as u8)
}

/// Hide part of the picture beyond reading: the box becomes coarse blocks of its own average colours, softened towards the
/// box's overall colour. The same picture always gives the same result.
pub fn blur_box(canvas: &mut Canvas, rect: [i32; 4], scale: f32) {
    let (cw, ch) = (canvas.width as i32, canvas.height as i32);
    let x0 = ((rect[0] as f32 * scale).floor() as i32).clamp(0, cw);
    let y0 = ((rect[1] as f32 * scale).floor() as i32).clamp(0, ch);
    let x1 = (((rect[0] + rect[2]) as f32 * scale).ceil() as i32).clamp(0, cw);
    let y1 = (((rect[1] + rect[3]) as f32 * scale).ceil() as i32).clamp(0, ch);
    if x1 <= x0 || y1 <= y0 {
        return;
    }
    let block = ((24.0 * scale).round() as i32).max(4);
    let stride = canvas.width as usize * 4;
    let px = |x: i32, y: i32| y as usize * stride + x as usize * 4;
    // The box's overall colour.
    let mut all = [0u64; 3];
    let mut n_all = 0u64;
    for y in y0..y1 {
        for x in x0..x1 {
            let i = px(x, y);
            for c in 0..3 {
                all[c] += canvas.bgra[i + c] as u64;
            }
            n_all += 1;
        }
    }
    let overall: Vec<u64> = all.iter().map(|v| v / n_all.max(1)).collect();
    let mut by = y0;
    while by < y1 {
        let mut bx = x0;
        let ey = (by + block).min(y1);
        while bx < x1 {
            let ex = (bx + block).min(x1);
            let mut sum = [0u64; 3];
            let mut n = 0u64;
            for y in by..ey {
                for x in bx..ex {
                    let i = px(x, y);
                    for c in 0..3 {
                        sum[c] += canvas.bgra[i + c] as u64;
                    }
                    n += 1;
                }
            }
            let fill: Vec<u8> = (0..3).map(|c| ((sum[c] / n.max(1)) * 2 / 5 + overall[c] * 3 / 5) as u8).collect();
            for y in by..ey {
                for x in bx..ex {
                    let i = px(x, y);
                    canvas.bgra[i..i + 3].copy_from_slice(&fill);
                    canvas.bgra[i + 3] = 255;
                }
            }
            bx = ex;
        }
        by = ey;
    }
}

fn draw_mark(canvas: &mut Canvas, m: &Mark, text: &dyn TextRenderer) -> Result<(), String> {
    let red = Rgb(224, 24, 45);
    match m.kind.as_str() {
        "box" => {
            if let Some([x, y, w, h]) = m.rect {
                let line = m.line.unwrap_or(6.0).round() as i32;
                canvas.stroke_rect(PixelRect::new(x, y, w, h), line, colour(&m.color, red));
            }
        }
        "arrow" => {
            if let (Some(s), Some(e)) = (m.start, m.end) {
                canvas.arrow((s[0], s[1]), (e[0], e[1]), m.line.unwrap_or(7.0), colour(&m.color, red));
            }
        }
        "label" | "key" => {
            if let Some([x, y, w, h]) = m.rect {
                let font = m.font_px.unwrap_or(34.0);
                text.draw(
                    canvas,
                    &TextRequest {
                        text: m.text.clone(),
                        area: PixelRect::new(x, y, w, h),
                        font_px: font,
                        bold: true,
                        color: colour(&m.color, Rgb(255, 255, 255)),
                        background: Some(colour(&m.background, if m.kind == "key" { Rgb(16, 32, 55) } else { red })),
                        align: EditAlign::Center,
                    },
                )?;
            }
        }
        other => return Err(format!("The plan has a callout of a kind this helper does not draw: \"{other}\".")),
    }
    Ok(())
}

/// A title or end card: the product in the accent colour, the title large, and up to three lines under it.
fn draw_card(card: &Card, w: u32, h: u32, text: &dyn TextRenderer) -> Result<Canvas, String> {
    let bg = Rgb::parse(&card.background).unwrap_or(Rgb(16, 32, 55));
    let accent = Rgb::parse(&card.accent).unwrap_or(Rgb(255, 123, 204));
    let fg = Rgb::parse(&card.color).unwrap_or(Rgb(255, 255, 255));
    let mut c = Canvas::new(w, h);
    c.clear(bg);
    let s = h as f32 / 1080.0;
    let left = (160.0 * s) as i32;
    let width = w as i32 - 2 * left;
    // A short bar in the accent colour above the words.
    c.fill_rect(PixelRect::new(left + (12.0 * s) as i32, (330.0 * s) as i32, (120.0 * s) as i32, (10.0 * s) as i32), accent);
    let mut y = (360.0 * s) as i32;
    if !card.kicker.is_empty() {
        let fit = text.draw(&mut c, &req(&card.kicker, left, y, width, (70.0 * s) as i32, 40.0 * s, true, accent))?;
        warn_cut(fit.complete, &card.kicker);
        y += (80.0 * s) as i32;
    }
    let fit = text.draw(&mut c, &req(&card.title, left, y, width, (210.0 * s) as i32, 80.0 * s, true, fg))?;
    warn_cut(fit.complete, &card.title);
    y += (230.0 * s) as i32;
    for line in card.lines.iter().take(3) {
        let fit = text.draw(&mut c, &req(line, left, y, width, (60.0 * s) as i32, 38.0 * s, false, fg))?;
        warn_cut(fit.complete, line);
        y += (64.0 * s) as i32;
    }
    Ok(c)
}

fn warn_cut(complete: bool, words: &str) {
    if !complete {
        say(json!({ "event": "warning", "message": format!("Some of \"{words}\" did not fit on its card and was cut off.") }));
    }
}

#[allow(clippy::too_many_arguments)]
fn req(text: &str, x: i32, y: i32, w: i32, h: i32, font: f32, bold: bool, color: Rgb) -> TextRequest {
    // The text starts a little in from its box, more for larger letters; move each box out by that much so every line on
    // the card starts at the same place.
    let pad = openstage_capture_render::padding(font);
    TextRequest { text: text.to_string(), area: PixelRect::new(x - pad, y - pad, w + pad, h + pad), font_px: font, bold, color, background: None, align: EditAlign::Left }
}

#[cfg(test)]
mod blur_tests {
    use super::blur_box;
    use openstage_capture_render::Canvas;

    #[test]
    fn a_blurred_box_changes_only_inside_it_and_hides_detail() {
        let mut c = Canvas::new(96, 48);
        // Fine stripes: detail that must not survive.
        for (k, p) in c.bgra.chunks_exact_mut(4).enumerate() {
            let v = if (k % 96) % 2 == 0 { 255 } else { 0 };
            p.copy_from_slice(&[v, v, v, 255]);
        }
        let before = c.bgra.clone();
        blur_box(&mut c, [0, 0, 48, 48], 1.0);
        let at = |b: &Vec<u8>, x: usize, y: usize| b[(y * 96 + x) * 4];
        assert_eq!(at(&c.bgra, 0, 0), at(&c.bgra, 1, 0), "neighbouring stripes are one colour after blurring");
        assert_eq!(at(&c.bgra, 60, 10), at(&before, 60, 10), "outside the box nothing changes");
        assert_eq!(at(&c.bgra, 61, 10), at(&before, 61, 10));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(json: &str) -> Plan {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn a_plan_with_a_gap_is_refused() {
        let p = plan(r##"{"width":64,"height":36,"fps":30,"frames":20,"segments":[{"from":0,"to":10,"card":{"title":"A"}},{"from":12,"to":20,"card":{"title":"B"}}]}"##);
        assert!(check_plan(&p).unwrap_err().contains("without gaps"));
    }

    #[test]
    fn a_plan_that_names_a_missing_picture_is_refused() {
        let p = plan(r##"{"width":64,"height":36,"fps":30,"frames":10,"segments":[{"from":0,"to":10,"picture":"k1"}]}"##);
        assert!(check_plan(&p).unwrap_err().contains("does not list"));
    }

    #[test]
    fn a_good_plan_passes() {
        let p = plan(r##"{"width":64,"height":36,"fps":30,"frames":10,"pictures":{"k1":"a.png"},"segments":[{"from":0,"to":4,"card":{"title":"A"}},{"from":4,"to":10,"picture":"k1","fadeIn":3}]}"##);
        check_plan(&p).unwrap();
    }

    #[test]
    fn black_on_white_has_the_highest_contrast() {
        assert!((contrast(Rgb(0, 0, 0), Rgb(255, 255, 255)) - 21.0).abs() < 0.01);
        assert!((contrast(Rgb(10, 10, 10), Rgb(10, 10, 10)) - 1.0).abs() < 0.01);
    }
}
