// SPDX-License-Identifier: Apache-2.0
//! Still pictures as PNG files, compressed, so a take of a hundred pictures stays small.
//!
//! The engine's own PNG writer stores pixels uncompressed (about 6 MB a picture at 1080p), which is right for one picture
//! but not for a take. These are ordinary PNG files that any viewer opens.

use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

/// Write `bgra` (blue, green, red, ignored byte) as an RGB PNG.
pub fn write_png(path: &Path, width: u32, height: u32, bgra: &[u8]) -> Result<(), String> {
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    for p in bgra.chunks_exact(4) {
        rgb.extend_from_slice(&[p[2], p[1], p[0]]);
    }
    let tmp = path.with_extension("png.part");
    {
        let file = File::create(&tmp).map_err(|e| format!("Could not create {}: {e}", tmp.display()))?;
        let mut encoder = png::Encoder::new(BufWriter::new(file), width, height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header().map_err(|e| format!("Could not write {}: {e}", path.display()))?;
        writer.write_image_data(&rgb).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
        writer.finish().map_err(|e| format!("Could not finish {}: {e}", path.display()))?;
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("Could not save {}: {e}", path.display()))
}

/// Read a PNG into blue, green, red, alpha bytes. Grey, RGB and RGBA pictures at 8 bits are accepted.
pub fn read_png(path: &Path) -> Result<(u32, u32, Vec<u8>), String> {
    let file = File::open(path).map_err(|e| format!("Could not open the picture {}: {e}", path.display()))?;
    let mut decoder = png::Decoder::new(std::io::BufReader::new(file));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|e| format!("{} is not a PNG picture that can be read: {e}", path.display()))?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let (w, h) = (info.width, info.height);
    let mut bgra = Vec::with_capacity(w as usize * h as usize * 4);
    let data = &buf[..info.buffer_size()];
    match info.color_type {
        png::ColorType::Rgb => data.chunks_exact(3).for_each(|p| bgra.extend_from_slice(&[p[2], p[1], p[0], 255])),
        png::ColorType::Rgba => data.chunks_exact(4).for_each(|p| bgra.extend_from_slice(&[p[2], p[1], p[0], p[3]])),
        png::ColorType::Grayscale => data.iter().for_each(|&g| bgra.extend_from_slice(&[g, g, g, 255])),
        png::ColorType::GrayscaleAlpha => data.chunks_exact(2).for_each(|p| bgra.extend_from_slice(&[p[0], p[0], p[0], p[1]])),
        other => return Err(format!("{} uses colours this helper does not read ({other:?}).", path.display())),
    }
    Ok((w, h, bgra))
}

/// A short fingerprint of a picture's pixels (FNV-1a, 64 bits), ignoring the unused fourth byte, as 16 hex digits.
pub fn fingerprint(bgra: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for p in bgra.chunks_exact(4) {
        for &b in &p[..3] {
            h ^= b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    }
    format!("{h:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_comes_back_as_it_was_written() {
        let dir = std::env::temp_dir().join(format!("studio-png-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.png");
        let bgra: Vec<u8> = (0..4 * 3 * 2).map(|i| if i % 4 == 3 { 255 } else { (i * 9) as u8 }).collect();
        write_png(&path, 3, 2, &bgra).unwrap();
        let (w, h, back) = read_png(&path).unwrap();
        assert_eq!((w, h), (3, 2));
        assert_eq!(back, bgra);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_fingerprint_ignores_the_fourth_byte() {
        assert_eq!(fingerprint(&[1, 2, 3, 0]), fingerprint(&[1, 2, 3, 255]));
        assert_ne!(fingerprint(&[1, 2, 3, 0]), fingerprint(&[1, 2, 4, 0]));
    }
}
