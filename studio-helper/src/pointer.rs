// SPDX-License-Identifier: Apache-2.0
//! The pointer drawn over the video, and the yellow circle that shows a click.
//!
//! The take is made without the real mouse (the demo-mode hook presses controls directly), so the pointer the viewer
//! follows is drawn here, at the place and time the timeline gives. Everything is whole-pixel arithmetic over fixed
//! shapes, so the same frame always gives the same bytes.

use openstage_capture_render::{Canvas, Rgb};

/// The arrow's outline, in units where the arrow is 20 tall; the tip is at (0, 0).
const ARROW: [(f32, f32); 7] = [(0.0, 0.0), (0.0, 17.0), (4.0, 13.2), (7.2, 20.0), (10.0, 18.8), (6.9, 12.2), (12.0, 12.2)];

fn inside(poly: &[(f32, f32)], x: f32, y: f32) -> bool {
    let mut odd = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let (xi, yi) = poly[i];
        let (xj, yj) = poly[j];
        if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
            odd = !odd;
        }
        j = i;
    }
    odd
}

/// Distance from (x, y) to the polygon's edge.
fn edge_distance(poly: &[(f32, f32)], x: f32, y: f32) -> f32 {
    let mut best = f32::MAX;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let (ax, ay) = poly[j];
        let (bx, by) = poly[i];
        let (dx, dy) = (bx - ax, by - ay);
        let len2 = dx * dx + dy * dy;
        let t = if len2 > 0.0 { (((x - ax) * dx + (y - ay) * dy) / len2).clamp(0.0, 1.0) } else { 0.0 };
        let (px, py) = (ax + t * dx - x, ay + t * dy - y);
        best = best.min((px * px + py * py).sqrt());
        j = i;
    }
    best
}

/// Draw the arrow pointer with its tip at (`x`, `y`). `scale` is pixels per unit (2.0 suits 1080p).
pub fn draw_pointer(canvas: &mut Canvas, x: f32, y: f32, scale: f32) {
    let outline = 1.4f32; // in units
    let poly: Vec<(f32, f32)> = ARROW.iter().map(|&(px, py)| (x + px * scale, y + py * scale)).collect();
    let (x0, y0) = ((x - 3.0 * scale).floor() as i32, (y - 3.0 * scale).floor() as i32);
    let (x1, y1) = ((x + 15.0 * scale).ceil() as i32, (y + 23.0 * scale).ceil() as i32);
    // A soft shadow first, then the black edge and white body, each smoothed by sampling 4 by 4 points a pixel.
    for py in y0.max(0)..y1.min(canvas.height as i32) {
        for px in x0.max(0)..x1.min(canvas.width as i32) {
            let mut body = 0u32;
            let mut edge = 0u32;
            let mut shadow = 0u32;
            for sy in 0..4 {
                for sx in 0..4 {
                    let fx = px as f32 + (sx as f32 + 0.5) / 4.0;
                    let fy = py as f32 + (sy as f32 + 0.5) / 4.0;
                    let inner = inside(&poly, fx, fy);
                    let d = edge_distance(&poly, fx, fy);
                    if inner && d > outline * scale * 0.5 {
                        body += 1;
                    } else if inner || d <= outline * scale * 0.5 {
                        edge += 1;
                    } else if inside(&poly, fx - 1.5 * scale, fy - 2.0 * scale) {
                        shadow += 1;
                    }
                }
            }
            if shadow > 0 {
                canvas.blend_pixel(px as u32, py as u32, Rgb(0, 0, 0), shadow * 70 / 16);
            }
            if edge > 0 {
                canvas.blend_pixel(px as u32, py as u32, Rgb(20, 20, 20), edge * 255 / 16);
            }
            if body > 0 {
                canvas.blend_pixel(px as u32, py as u32, Rgb(255, 255, 255), body * 255 / 16);
            }
        }
    }
}

/// How long the click circle shows, in milliseconds.
pub const CLICK_MS: u64 = 600;

/// The yellow click circle around (`x`, `y`), `age_ms` after the click: it grows a little and fades.
pub fn draw_click(canvas: &mut Canvas, x: f32, y: f32, age_ms: u64, scale: f32) {
    if age_ms >= CLICK_MS {
        return;
    }
    let t = age_ms as f32 / CLICK_MS as f32;
    let radius = (14.0 + 6.0 * t) * scale;
    let ring = 2.2 * scale;
    let fade = 1.0 - t * t;
    let fill_share = (110.0 * fade) as u32;
    let ring_share = (240.0 * fade) as u32;
    let r = radius.ceil() as i32 + 2;
    let (cx, cy) = (x.round() as i32, y.round() as i32);
    for py in (cy - r).max(0)..(cy + r).min(canvas.height as i32) {
        for px in (cx - r).max(0)..(cx + r).min(canvas.width as i32) {
            let (dx, dy) = (px as f32 + 0.5 - x, py as f32 + 0.5 - y);
            let d = (dx * dx + dy * dy).sqrt();
            if d <= radius - ring {
                canvas.blend_pixel(px as u32, py as u32, Rgb(255, 214, 10), fill_share);
            } else if d <= radius {
                canvas.blend_pixel(px as u32, py as u32, Rgb(245, 166, 0), ring_share);
            } else if d <= radius + 1.0 {
                let edge = (radius + 1.0 - d).clamp(0.0, 1.0);
                canvas.blend_pixel(px as u32, py as u32, Rgb(245, 166, 0), (ring_share as f32 * edge) as u32);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pointer_is_drawn_the_same_every_time() {
        let mut a = Canvas::new(80, 80);
        let mut b = Canvas::new(80, 80);
        draw_pointer(&mut a, 10.3, 12.7, 2.0);
        draw_pointer(&mut b, 10.3, 12.7, 2.0);
        assert_eq!(a.bgra, b.bgra);
        // The body is white somewhere inside the arrow.
        assert_eq!(a.pixel(14, 30), Rgb(255, 255, 255));
    }

    #[test]
    fn the_click_circle_goes_away_after_its_time() {
        let mut c = Canvas::new(60, 60);
        let before = c.bgra.clone();
        draw_click(&mut c, 30.0, 30.0, CLICK_MS, 1.0);
        assert_eq!(c.bgra, before);
        draw_click(&mut c, 30.0, 30.0, 0, 1.0);
        assert_ne!(c.bgra, before);
    }
}
