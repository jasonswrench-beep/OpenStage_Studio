// SPDX-License-Identifier: Apache-2.0
//! `slides --plan <file>`: draw a lecture's slides (development list item 3) as still pictures, one PNG each, named by
//! the fingerprint of its pixels like a take's pictures, so the rest of the video is made exactly as a tutorial's is.
//!
//! A slide: the course's name small in the accent colour, the title large, a short bar, then up to six points, each with a
//! square bullet; a picture the author owns sits on the right half when there is one; the slide's number at the bottom.
//! Drawn with the shared core's canvas and Windows' text, as the title cards are, so the same plan always gives the same
//! pixels.

use crate::{arg, pngio, say};
use openstage_capture_project::EditAlign;
use openstage_capture_render::{Canvas, PixelRect, Rgb, TextRenderer, TextRequest};
use serde::Deserialize;
use serde_json::json;
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlidePlan {
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub style: Style,
    pub out: String,
    pub slides: Vec<Slide>,
}

#[derive(Deserialize, Default)]
pub struct Style {
    #[serde(default)]
    pub background: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub accent: String,
    #[serde(default)]
    pub muted: String,
}

#[derive(Deserialize)]
pub struct Slide {
    #[serde(default)]
    pub kicker: String,
    pub title: String,
    #[serde(default)]
    pub points: Vec<String>,
    /// A PNG file, by its full path.
    #[serde(default)]
    pub picture: Option<String>,
    pub number: u32,
    pub total: u32,
}

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

pub fn run(args: &[String]) -> Result<(), String> {
    let plan_path = arg(args, "--plan").ok_or("Say which plan to draw: --plan <file>.")?;
    let text = std::fs::read_to_string(&plan_path).map_err(|e| format!("Could not read {plan_path}: {e}"))?;
    let plan: SlidePlan = serde_json::from_str(&text).map_err(|e| format!("The slide plan is not right: {e}"))?;
    let out = PathBuf::from(&plan.out);
    std::fs::create_dir_all(&out).map_err(|e| format!("Could not make the folder {}: {e}", out.display()))?;
    let renderer = text_renderer();
    let mut files = Vec::new();
    for slide in &plan.slides {
        let canvas = draw_slide(slide, &plan.style, plan.width, plan.height, renderer.as_ref())?;
        let hash = pngio::fingerprint(&canvas.bgra);
        let file = out.join(format!("{hash}.png"));
        if !file.exists() {
            pngio::write_png(&file, plan.width, plan.height, &canvas.bgra)?;
        }
        files.push(json!({ "number": slide.number, "file": file.to_string_lossy(), "hash": hash }));
    }
    say(json!({ "event": "slides", "files": files }));
    Ok(())
}

fn colour(s: &str, fallback: Rgb) -> Rgb {
    Rgb::parse(s).unwrap_or(fallback)
}

fn req(text: &str, x: i32, y: i32, w: i32, h: i32, font: f32, bold: bool, color: Rgb) -> TextRequest {
    let pad = openstage_capture_render::padding(font);
    TextRequest { text: text.to_string(), area: PixelRect::new(x - pad, y - pad, w + pad, h + pad), font_px: font, bold, color, background: None, align: EditAlign::Left }
}

fn warn_cut(complete: bool, number: u32, words: &str) {
    if !complete {
        say(json!({ "event": "warning", "message": format!("On slide {number}, some of \"{words}\" did not fit and was cut off. Shorten it.") }));
    }
}

pub fn draw_slide(slide: &Slide, style: &Style, w: u32, h: u32, text: &dyn TextRenderer) -> Result<Canvas, String> {
    let bg = colour(&style.background, Rgb(247, 248, 250));
    let fg = colour(&style.color, Rgb(16, 32, 55));
    let accent = colour(&style.accent, Rgb(196, 30, 120));
    let muted = colour(&style.muted, Rgb(79, 91, 105));
    let s = h as f32 / 1080.0;
    let px = |v: f32| (v * s) as i32;
    let mut c = Canvas::new(w, h);
    c.clear(bg);
    let left = px(120.0);
    let full = w as i32 - 2 * left;

    // The picture, fitted into the right half, keeping its shape.
    let picture = match &slide.picture {
        Some(file) => Some(pngio::read_png(std::path::Path::new(file)).map_err(|e| format!("Slide {}: the picture could not be read: {e}", slide.number))?),
        None => None,
    };
    let text_width = if picture.is_some() { px(820.0) } else { full };

    let mut y = px(80.0);
    if !slide.kicker.is_empty() {
        let fit = text.draw(&mut c, &req(&slide.kicker, left, y, full, px(50.0), 30.0 * s, true, accent))?;
        warn_cut(fit.complete, slide.number, &slide.kicker);
    }
    y += px(60.0);
    let fit = text.draw(&mut c, &req(&slide.title, left, y, full, px(170.0), 64.0 * s, true, fg))?;
    warn_cut(fit.complete, slide.number, &slide.title);
    y += px(190.0);
    c.fill_rect(PixelRect::new(left + px(4.0), y, px(110.0), px(8.0)), accent);
    y += px(50.0);
    for point in slide.points.iter().take(6) {
        c.fill_rect(PixelRect::new(left + px(4.0), y + px(18.0), px(16.0), px(16.0)), accent);
        let fit = text.draw(&mut c, &req(point, left + px(44.0), y, text_width - px(44.0), px(112.0), 40.0 * s, false, fg))?;
        warn_cut(fit.complete, slide.number, point);
        y += px(118.0);
    }
    if let Some((pw, ph, bgra)) = picture {
        let pic = openstage_capture_render::Picture::new(pw, ph, bgra);
        let (bx, by, bw, bh) = (px(1000.0), px(330.0), px(800.0), px(620.0));
        let scale = (bw as f64 / pw as f64).min(bh as f64 / ph as f64);
        let (dw, dh) = ((pw as f64 * scale) as i32, (ph as f64 * scale) as i32);
        c.draw_picture(
            &pic,
            openstage_capture_render::SourceRect { x: 0.0, y: 0.0, w: pw as f64, h: ph as f64 },
            PixelRect::new(bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh),
        );
    }
    let number = format!("{} / {}", slide.number, slide.total);
    text.draw(&mut c, &req(&number, w as i32 - px(320.0), h as i32 - px(80.0), px(200.0), px(44.0), 26.0 * s, false, muted))?;
    Ok(c)
}
