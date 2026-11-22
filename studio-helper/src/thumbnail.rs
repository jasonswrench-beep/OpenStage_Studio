// SPDX-License-Identifier: Apache-2.0
//! The thumbnail for the publishing package (1280 by 720 PNG), from the product's template: the product's name and the
//! video's title on the left, and on the right a close view of the program from one step of the take.
//!
//! `thumbnail --plan <file> --out <png>`. The plan is written by OpenStage Studio (src/package/thumbnail.ts).

use crate::{arg, assemble::blur_box, pngio, say};
use openstage_capture_project::EditAlign;
use openstage_capture_render::{Canvas, PixelRect, Rgb, SourceRect, TextRenderer, TextRequest};
use serde::Deserialize;
use serde_json::json;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Plan {
    width: u32,
    height: u32,
    background: String,
    accent: String,
    color: String,
    kicker: String,
    title: String,
    #[serde(default)]
    footer: String,
    /// A still picture of the take, 1920 by 1080, and the point of it to show closest.
    picture: Option<String>,
    #[serde(default)]
    focus: Option<[f32; 2]>,
    /// Blurred boxes on that picture (from review), in its pixels.
    #[serde(default)]
    redactions: Vec<[i32; 4]>,
    /// The product's spectrum for the bars, instead of the accent (brand.rs). Empty: the accent.
    #[serde(default)]
    spectrum: Vec<String>,
    /// The product's mark, a PNG drawn above the words. None: no mark.
    #[serde(default)]
    mark: Option<String>,
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

fn req(text: &str, x: i32, y: i32, w: i32, h: i32, font: f32, bold: bool, color: Rgb) -> TextRequest {
    let pad = openstage_capture_render::padding(font);
    TextRequest { text: text.to_string(), area: PixelRect::new(x - pad, y - pad, w + pad, h + pad), font_px: font, bold, color, background: None, align: EditAlign::Left }
}

pub fn run(args: &[String]) -> Result<(), String> {
    let plan_path = arg(args, "--plan").ok_or("Say where the thumbnail's plan is with --plan.")?;
    let out = PathBuf::from(arg(args, "--out").ok_or("Say where the thumbnail goes with --out.")?);
    let plan: Plan = serde_json::from_slice(&std::fs::read(&plan_path).map_err(|e| format!("Could not read {plan_path}: {e}"))?)
        .map_err(|e| format!("The thumbnail plan in {plan_path} is not right: {e}"))?;
    let base = Path::new(&plan_path).parent().unwrap_or(Path::new(".")).to_path_buf();
    let (w, h) = (plan.width, plan.height);
    let s = h as f32 / 720.0;
    let bg = Rgb::parse(&plan.background).map_err(|_| format!("\"{}\" is not a colour.", plan.background))?;
    let accent = Rgb::parse(&plan.accent).map_err(|_| format!("\"{}\" is not a colour.", plan.accent))?;
    let fg = Rgb::parse(&plan.color).map_err(|_| format!("\"{}\" is not a colour.", plan.color))?;
    let text = text_renderer();
    let spectrum = crate::brand::spectrum_of(&plan.spectrum);
    let mut c = Canvas::new(w, h);
    c.clear(bg);

    // The close view of the program, on the right, framed in the accent colour.
    let panel_x = (720.0 * s) as i32;
    if let Some(file) = &plan.picture {
        let path = if Path::new(file).is_absolute() { PathBuf::from(file) } else { base.join(file) };
        let (pw, ph, bgra) = pngio::read_png(&path)?;
        let mut pic_canvas = Canvas::new(pw, ph);
        pic_canvas.bgra.copy_from_slice(&bgra);
        for r in &plan.redactions {
            blur_box(&mut pic_canvas, *r, pw as f32 / 1920.0);
        }
        let picture = openstage_capture_render::Picture::new(pw, ph, pic_canvas.bgra);
        let (tw, th) = (w as i32 - panel_x, h as i32);
        // Shown at two thirds of its size, so the controls read on a small thumbnail, centred on the focus point.
        let zoom = 0.66 * s * (1920.0 / pw as f32);
        let (sw, sh) = ((tw as f32 / zoom).min(pw as f32), (th as f32 / zoom).min(ph as f32));
        let [fx, fy] = plan.focus.unwrap_or([pw as f32 / 2.0, ph as f32 / 2.0]);
        let sx = (fx - sw / 2.0).clamp(0.0, pw as f32 - sw);
        let sy = (fy - sh / 2.0).clamp(0.0, ph as f32 - sh);
        c.draw_picture(&picture, SourceRect { x: sx as f64, y: sy as f64, w: sw as f64, h: sh as f64 }, PixelRect::new(panel_x, 0, tw, th));
        crate::brand::bar(&mut c, PixelRect::new(panel_x - (10.0 * s) as i32, 0, (10.0 * s) as i32, th), spectrum.as_deref(), accent, false);
    }

    // The words, on the left.
    let left = (64.0 * s) as i32;
    let width = panel_x - left - (48.0 * s) as i32;
    if let Some(mark) = &plan.mark {
        let path = if Path::new(mark).is_absolute() { PathBuf::from(mark) } else { base.join(mark) };
        crate::brand::draw_mark(&mut c, &path, left, (44.0 * s) as i32, (90.0 * s) as i32)?;
    }
    crate::brand::bar(&mut c, PixelRect::new(left, (150.0 * s) as i32, (96.0 * s) as i32, (10.0 * s) as i32), spectrum.as_deref(), accent, true);
    let mut y = (180.0 * s) as i32;
    let kicker = text.draw(&mut c, &req(&plan.kicker, left, y, width, (60.0 * s) as i32, 36.0 * s, true, accent))?;
    y += (72.0 * s) as i32;
    let title = text.draw(&mut c, &req(&plan.title, left, y, width, (300.0 * s) as i32, 68.0 * s, true, fg))?;
    for (fit, words) in [(kicker.complete, &plan.kicker), (title.complete, &plan.title)] {
        if !fit {
            say(json!({ "event": "warning", "message": format!("Some of \"{words}\" did not fit on the thumbnail and was cut off.") }));
        }
    }
    if !plan.footer.is_empty() {
        text.draw(&mut c, &req(&plan.footer, left, (610.0 * s) as i32, width, (50.0 * s) as i32, 30.0 * s, false, fg))?;
    }
    pngio::write_png(&out, w, h, &c.bgra)?;
    say(json!({ "event": "thumbnail", "file": out.display().to_string() }));
    Ok(())
}
