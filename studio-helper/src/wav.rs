// SPDX-License-Identifier: Apache-2.0
//! Reading the narration's WAV files and turning them into the video's sound: 48,000 samples a second, two channels.

use std::path::Path;

/// The sound of a WAV file, one channel, as numbers from -1 to 1, with its rate.
pub struct Mono {
    pub rate: u32,
    pub samples: Vec<f32>,
}

/// Read a 16-bit PCM WAV file (any rate, one or two channels; two are averaged).
pub fn read_wav(path: &Path) -> Result<Mono, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Could not open the sound file {}: {e}", path.display()))?;
    parse_wav(&bytes).map_err(|e| format!("{}: {e}", path.display()))
}

pub fn parse_wav(bytes: &[u8]) -> Result<Mono, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a WAV file".into());
    }
    let mut pos = 12;
    let (mut channels, mut rate, mut bits, mut format) = (0u16, 0u32, 0u16, 0u16);
    let mut data: Option<&[u8]> = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let body = &bytes[pos + 8..(pos + 8 + size).min(bytes.len())];
        if id == b"fmt " && body.len() >= 16 {
            format = u16::from_le_bytes([body[0], body[1]]);
            channels = u16::from_le_bytes([body[2], body[3]]);
            rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
            bits = u16::from_le_bytes([body[14], body[15]]);
            if format == 0xFFFE && body.len() >= 26 {
                format = u16::from_le_bytes([body[24], body[25]]);
            }
        } else if id == b"data" {
            data = Some(body);
        }
        pos += 8 + size + (size & 1);
    }
    let data = data.ok_or("the file has no sound data")?;
    if format != 1 || bits != 16 || channels == 0 || channels > 2 || rate == 0 {
        return Err(format!("only 16-bit PCM sound in one or two channels is read (this is format {format}, {bits} bits, {channels} channels)"));
    }
    let frame = 2 * channels as usize;
    let samples = data
        .chunks_exact(frame)
        .map(|f| {
            let a = i16::from_le_bytes([f[0], f[1]]) as f32;
            let b = if channels == 2 { i16::from_le_bytes([f[2], f[3]]) as f32 } else { a };
            (a + b) / 2.0 / 32768.0
        })
        .collect();
    Ok(Mono { rate, samples })
}

/// How long a WAV file's sound lasts, in milliseconds.
pub fn duration_ms(mono: &Mono) -> u64 {
    (mono.samples.len() as u64 * 1000) / mono.rate as u64
}

/// Change the rate of `input` to `to`, with a windowed-sinc filter (16 taps each side). The same input always gives the
/// same output.
pub fn resample(input: &Mono, to: u32) -> Vec<f32> {
    if input.rate == to {
        return input.samples.clone();
    }
    let ratio = to as f64 / input.rate as f64;
    let out_len = (input.samples.len() as f64 * ratio).round() as usize;
    let cutoff = ratio.min(1.0);
    const TAPS: i64 = 16;
    let mut out = Vec::with_capacity(out_len);
    for n in 0..out_len {
        let t = n as f64 / ratio;
        let centre = t.floor() as i64;
        let mut acc = 0.0f64;
        let mut weight = 0.0f64;
        for k in (centre - TAPS + 1)..=(centre + TAPS) {
            let x = t - k as f64;
            let w = window(x / TAPS as f64) * sinc(x * cutoff) * cutoff;
            if k >= 0 && (k as usize) < input.samples.len() {
                acc += input.samples[k as usize] as f64 * w;
            }
            weight += w;
        }
        out.push(if weight.abs() > 1e-9 { (acc / weight) as f32 } else { 0.0 });
    }
    out
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-9 {
        1.0
    } else {
        let px = std::f64::consts::PI * x;
        px.sin() / px
    }
}

/// A Blackman window over -1..1.
fn window(x: f64) -> f64 {
    if x.abs() >= 1.0 {
        return 0.0;
    }
    let a = std::f64::consts::PI * (x + 1.0);
    0.42 - 0.5 * a.cos() + 0.08 * (2.0 * a).cos()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(rate: u32, samples: &[i16]) -> Vec<u8> {
        let mut out = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * 2).to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&((samples.len() * 2) as u32).to_le_bytes());
        samples.iter().for_each(|s| out.extend_from_slice(&s.to_le_bytes()));
        out
    }

    #[test]
    fn a_wav_file_is_read_and_its_length_known() {
        let mono = parse_wav(&wav(16000, &vec![1000; 8000])).unwrap();
        assert_eq!(mono.rate, 16000);
        assert_eq!(duration_ms(&mono), 500);
    }

    #[test]
    fn resampling_keeps_the_length_and_a_steady_level() {
        let mono = Mono { rate: 22050, samples: vec![0.5; 22050] };
        let out = resample(&mono, 48000);
        assert_eq!(out.len(), 48000);
        assert!((out[24000] - 0.5).abs() < 0.01);
    }

    #[test]
    fn resampling_is_the_same_every_time() {
        let mono = Mono { rate: 16000, samples: (0..1600).map(|i| ((i as f32) * 0.05).sin()).collect() };
        assert_eq!(resample(&mono, 48000), resample(&mono, 48000));
    }
}
