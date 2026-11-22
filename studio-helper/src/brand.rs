// SPDX-License-Identifier: Apache-2.0
//! A product's own look on the title and end cards and the thumbnail, when its template asks for one: a bar in the product's
//! spectrum (its colours blended evenly one into the next) instead of the single accent colour, and the product's mark, a PNG with
//! see-through parts, drawn in front of the words. PrismQDA's videos use both (the prism's cyan, violet, pink and orange, and the
//! prism mark). A template without them draws exactly as before.

use crate::pngio;
use openstage_capture_render::{Canvas, Picture, PixelRect, Rgb, SourceRect};
use std::path::Path;

/// The spectrum's colours, when there are two or more and every one is a colour.
pub fn spectrum_of(list: &[String]) -> Option<Vec<Rgb>> {
    let colours: Vec<Rgb> = list.iter().filter_map(|c| Rgb::parse(c).ok()).collect();
    (colours.len() >= 2 && colours.len() == list.len()).then_some(colours)
}

fn mix(a: Rgb, b: Rgb, t: f32) -> Rgb {
    let m = |x: u8, y: u8| (x as f32 + (y as f32 - x as f32) * t).round().clamp(0.0, 255.0) as u8;
    Rgb(m(a.0, b.0), m(a.1, b.1), m(a.2, b.2))
}

/// The colour a share `t` (0 to 1) of the way along the spectrum.
pub fn at(colours: &[Rgb], t: f32) -> Rgb {
    let t = t.clamp(0.0, 1.0) * (colours.len() - 1) as f32;
    let i = (t.floor() as usize).min(colours.len() - 2);
    mix(colours[i], colours[i + 1], t - i as f32)
}

/// Fills `rect` with the spectrum, left to right when `across`, else top to bottom.
pub fn fill_spectrum(c: &mut Canvas, rect: PixelRect, colours: &[Rgb], across: bool) {
    let steps = if across { rect.w } else { rect.h };
    for k in 0..steps.max(0) {
        let colour = at(colours, if steps > 1 { k as f32 / (steps - 1) as f32 } else { 0.0 });
        let strip = if across { PixelRect::new(rect.x + k, rect.y, 1, rect.h) } else { PixelRect::new(rect.x, rect.y + k, rect.w, 1) };
        c.fill_rect(strip, colour);
    }
}

/// A bar: the spectrum when there is one, else the accent colour.
pub fn bar(c: &mut Canvas, rect: PixelRect, spectrum: Option<&[Rgb]>, accent: Rgb, across: bool) {
    match spectrum {
        Some(colours) => fill_spectrum(c, rect, colours, across),
        None => c.fill_rect(rect, accent),
    }
}

/// Draws the mark from `file` (a PNG) `height` pixels tall with its top left at (`x`, `y`), keeping its shape. Returns its width.
pub fn draw_mark(c: &mut Canvas, file: &Path, x: i32, y: i32, height: i32) -> Result<i32, String> {
    let (w, h, bgra) = pngio::read_png(file)?;
    if w == 0 || h == 0 {
        return Ok(0);
    }
    let width = (height as f64 * w as f64 / h as f64).round();
    let picture = Picture::new(w, h, bgra);
    c.draw_picture_to(&picture, SourceRect { x: 0.0, y: 0.0, w: w as f64, h: h as f64 }, SourceRect { x: x as f64, y: y as f64, w: width, h: height as f64 });
    Ok(width as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_spectrum_runs_from_its_first_colour_to_its_last() {
        let s = spectrum_of(&["#000000".into(), "#FF0000".into(), "#FFFFFF".into()]).unwrap();
        assert_eq!(at(&s, 0.0), Rgb(0, 0, 0));
        assert_eq!(at(&s, 0.5), Rgb(255, 0, 0));
        assert_eq!(at(&s, 1.0), Rgb(255, 255, 255));
        assert_eq!(at(&s, 0.25), Rgb(128, 0, 0));
        assert!(spectrum_of(&["#000000".into()]).is_none(), "one colour is not a spectrum");
        assert!(spectrum_of(&["#000000".into(), "pink".into()]).is_none(), "every one must be a colour");
    }

    #[test]
    fn a_bar_with_no_spectrum_is_the_accent() {
        let mut c = Canvas::new(20, 4);
        bar(&mut c, PixelRect::new(0, 0, 20, 4), None, Rgb(1, 2, 3), true);
        assert_eq!(&c.bgra[0..3], &[3, 2, 1]);
        let s = spectrum_of(&["#000000".into(), "#0000FF".into()]).unwrap();
        bar(&mut c, PixelRect::new(0, 0, 20, 4), Some(&s), Rgb(1, 2, 3), true);
        assert_eq!(&c.bgra[0..3], &[0, 0, 0], "the left end is the first colour");
        assert_eq!(&c.bgra[19 * 4..19 * 4 + 3], &[255, 0, 0], "the right end is the last (blue, stored BGR)");
    }
}
