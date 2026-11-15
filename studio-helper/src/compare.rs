// SPDX-License-Identifier: Apache-2.0
//! Whether two finished videos are the same video: the acceptance test for repeatable takes.
//!
//! Two MP4 files made from the same script are never identical byte for byte (the file records when it was written), so
//! this reads both back with Windows' own decoder and compares what a viewer gets: the number of frames, every frame's
//! pixels, and the sound. Identical frames are counted; frames that differ are measured (peak signal to noise ratio,
//! in decibels; 40 and above cannot be told apart by eye).

use crate::{arg, say};
use serde_json::json;

/// Below this, two frames are said to differ visibly.
pub const SAME_PSNR_DB: f64 = 40.0;

pub fn run(args: &[String]) -> Result<(), String> {
    let a = arg(args, "--a").ok_or("Say the first video with --a.")?;
    let b = arg(args, "--b").ok_or("Say the second video with --b.")?;
    let mut ra = imp::Reader::open(&a, true)?;
    let mut rb = imp::Reader::open(&b, true)?;
    if (ra.width, ra.height) != (rb.width, rb.height) {
        say(json!({ "event": "compared", "same": false,
            "message": format!("The videos are different sizes: {} by {} and {} by {}.", ra.width, ra.height, rb.width, rb.height) }));
        return Ok(());
    }
    let (mut frames_a, mut frames_b, mut identical) = (0u64, 0u64, 0u64);
    let (mut worst_psnr, mut worst_frame) = (f64::INFINITY, 0u64);
    loop {
        let fa = ra.next_frame()?;
        let fb = rb.next_frame()?;
        match (&fa, &fb) {
            (Some(x), Some(y)) => {
                frames_a += 1;
                frames_b += 1;
                let p = psnr(x, y);
                if p.is_infinite() {
                    identical += 1;
                } else if p < worst_psnr {
                    worst_psnr = p;
                    worst_frame = frames_a - 1;
                }
            }
            (Some(_), None) => frames_a += 1,
            (None, Some(_)) => frames_b += 1,
            (None, None) => break,
        }
    }
    let sound_a = imp::read_sound(&a)?;
    let sound_b = imp::read_sound(&b)?;
    let (sound_same, sound_note) = compare_sound(&sound_a, &sound_b);
    let pictures_same = frames_a == frames_b && (identical == frames_a || worst_psnr >= SAME_PSNR_DB);
    let same = pictures_same && sound_same;
    let message = if same {
        format!(
            "The same video: {frames_a} frames each, {identical} of them identical to the pixel{}; {sound_note}",
            if identical == frames_a { String::new() } else { format!(", and the closest of the rest {worst_psnr:.1} dB (frame {worst_frame})") }
        )
    } else if frames_a != frames_b {
        format!("Different videos: {frames_a} frames and {frames_b} frames. {sound_note}")
    } else if !pictures_same {
        format!("Different pictures: frame {worst_frame} differs visibly ({worst_psnr:.1} dB; {SAME_PSNR_DB} dB or more is the same to the eye). {identical} of {frames_a} frames are identical. {sound_note}")
    } else {
        format!("The pictures are the same ({identical} of {frames_a} frames identical) but {sound_note}")
    };
    say(json!({ "event": "compared", "same": same, "frames": [frames_a, frames_b], "identicalFrames": identical,
        "worstPsnrDb": if worst_psnr.is_finite() { json!(worst_psnr) } else { json!(null) }, "worstFrame": worst_frame,
        "soundSamples": [sound_a.len(), sound_b.len()], "soundSame": sound_same, "message": message }));
    Ok(())
}

/// Peak signal to noise ratio of two frames' colours, in decibels; infinite when identical.
pub fn psnr(a: &[u8], b: &[u8]) -> f64 {
    let mut sum = 0u64;
    let mut n = 0u64;
    for (pa, pb) in a.chunks_exact(4).zip(b.chunks_exact(4)) {
        for k in 0..3 {
            let d = pa[k] as i64 - pb[k] as i64;
            sum += (d * d) as u64;
        }
        n += 3;
    }
    if sum == 0 || n == 0 {
        return f64::INFINITY;
    }
    let mse = sum as f64 / n as f64;
    10.0 * (255.0 * 255.0 / mse).log10()
}

/// Whether two sound tracks are the same to the ear: the same length (to within a frame of sound) and a difference far
/// below the sound itself.
pub fn compare_sound(a: &[i16], b: &[i16]) -> (bool, String) {
    if a.is_empty() && b.is_empty() {
        return (true, "neither has sound.".into());
    }
    let len_gap = (a.len() as i64 - b.len() as i64).unsigned_abs();
    if len_gap > 3200 {
        return (false, format!("the sound is a different length ({} and {} samples).", a.len(), b.len()));
    }
    let n = a.len().min(b.len());
    if a[..n] == b[..n] {
        return (true, "the sound is identical.".into());
    }
    let (mut diff, mut level) = (0f64, 0f64);
    for i in 0..n {
        let d = a[i] as f64 - b[i] as f64;
        diff += d * d;
        level += a[i] as f64 * a[i] as f64;
    }
    let ratio = if level > 0.0 { (diff / level).sqrt() } else { 0.0 };
    if ratio < 0.01 {
        (true, format!("the sound differs by {:.3} percent, which cannot be heard.", ratio * 100.0))
    } else {
        (false, format!("the sound differs by {:.1} percent.", ratio * 100.0))
    }
}

#[cfg(windows)]
mod imp {
    use windows::core::HSTRING;
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    fn start() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let _ = MFStartup(MF_VERSION, MFSTARTUP_FULL);
        }
    }

    fn open_reader(path: &str) -> Result<IMFSourceReader, String> {
        start();
        unsafe {
            let mut attrs: Option<IMFAttributes> = None;
            MFCreateAttributes(&mut attrs, 2).map_err(|e| e.to_string())?;
            let attrs = attrs.ok_or("no attributes")?;
            attrs.SetUINT32(&MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 1).map_err(|e| e.to_string())?;
            MFCreateSourceReaderFromURL(&HSTRING::from(path), &attrs).map_err(|e| format!("Windows could not open {path}: {e}"))
        }
    }

    pub struct Reader {
        reader: IMFSourceReader,
        pub width: u32,
        pub height: u32,
    }

    const VIDEO: u32 = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;
    const AUDIO: u32 = MF_SOURCE_READER_FIRST_AUDIO_STREAM.0 as u32;
    const ALL: u32 = MF_SOURCE_READER_ALL_STREAMS.0 as u32;

    impl Reader {
        pub fn open(path: &str, _video: bool) -> Result<Self, String> {
            let reader = open_reader(path)?;
            unsafe {
                reader.SetStreamSelection(ALL, false).map_err(|e| e.to_string())?;
                reader.SetStreamSelection(VIDEO, true).map_err(|e| format!("{path} has no video: {e}"))?;
                let mt = MFCreateMediaType().map_err(|e| e.to_string())?;
                mt.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).map_err(|e| e.to_string())?;
                mt.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32).map_err(|e| e.to_string())?;
                reader.SetCurrentMediaType(VIDEO, None, &mt).map_err(|e| format!("Windows could not decode {path}: {e}"))?;
                let current = reader.GetCurrentMediaType(VIDEO).map_err(|e| e.to_string())?;
                let size = current.GetUINT64(&MF_MT_FRAME_SIZE).map_err(|e| e.to_string())?;
                Ok(Self { reader, width: (size >> 32) as u32, height: (size & 0xFFFF_FFFF) as u32 })
            }
        }

        /// The next frame's pixels (blue, green, red, unused), or nothing at the end.
        pub fn next_frame(&mut self) -> Result<Option<Vec<u8>>, String> {
            loop {
                let mut flags = 0u32;
                let mut sample: Option<IMFSample> = None;
                unsafe {
                    self.reader
                        .ReadSample(VIDEO, 0, None, Some(&mut flags), None, Some(&mut sample))
                        .map_err(|e| format!("Could not read a frame: {e}"))?;
                }
                if flags & (MF_SOURCE_READERF_ENDOFSTREAM.0 as u32) != 0 {
                    return Ok(None);
                }
                let Some(sample) = sample else { continue };
                return unsafe { sample_bytes(&sample) }.map(|mut v| {
                    v.truncate(self.width as usize * self.height as usize * 4);
                    Some(v)
                });
            }
        }
    }

    unsafe fn sample_bytes(sample: &IMFSample) -> Result<Vec<u8>, String> {
        let buffer = sample.ConvertToContiguousBuffer().map_err(|e| e.to_string())?;
        let mut ptr = std::ptr::null_mut();
        let mut len = 0u32;
        buffer.Lock(&mut ptr, None, Some(&mut len)).map_err(|e| e.to_string())?;
        let bytes = std::slice::from_raw_parts(ptr, len as usize).to_vec();
        let _ = buffer.Unlock();
        Ok(bytes)
    }

    /// The whole sound track as 16-bit samples (empty when there is none).
    pub fn read_sound(path: &str) -> Result<Vec<i16>, String> {
        let reader = open_reader(path)?;
        unsafe {
            reader.SetStreamSelection(ALL, false).map_err(|e| e.to_string())?;
            if reader.SetStreamSelection(AUDIO, true).is_err() {
                return Ok(Vec::new());
            }
            let mt = MFCreateMediaType().map_err(|e| e.to_string())?;
            mt.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio).map_err(|e| e.to_string())?;
            mt.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM).map_err(|e| e.to_string())?;
            mt.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16).map_err(|e| e.to_string())?;
            reader.SetCurrentMediaType(AUDIO, None, &mt).map_err(|e| format!("Windows could not decode the sound of {path}: {e}"))?;
            let mut out = Vec::new();
            loop {
                let mut flags = 0u32;
                let mut sample: Option<IMFSample> = None;
                reader.ReadSample(AUDIO, 0, None, Some(&mut flags), None, Some(&mut sample)).map_err(|e| e.to_string())?;
                if flags & (MF_SOURCE_READERF_ENDOFSTREAM.0 as u32) != 0 {
                    break;
                }
                if let Some(s) = sample {
                    let bytes = sample_bytes(&s)?;
                    out.extend(bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])));
                }
            }
            Ok(out)
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub struct Reader {
        pub width: u32,
        pub height: u32,
    }
    impl Reader {
        pub fn open(_: &str, _: bool) -> Result<Self, String> {
            Err("Videos are read back only on Windows.".into())
        }
        pub fn next_frame(&mut self) -> Result<Option<Vec<u8>>, String> {
            Ok(None)
        }
    }
    pub fn read_sound(_: &str) -> Result<Vec<i16>, String> {
        Err("Videos are read back only on Windows.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_frames_have_no_noise() {
        assert!(psnr(&[1, 2, 3, 0, 4, 5, 6, 0], &[1, 2, 3, 9, 4, 5, 6, 9]).is_infinite());
    }

    #[test]
    fn a_small_difference_is_still_the_same_to_the_eye() {
        let a = vec![100u8; 4000];
        let mut b = a.clone();
        b[0] = 101;
        assert!(psnr(&a, &b) > SAME_PSNR_DB);
    }

    #[test]
    fn sound_of_different_lengths_is_different() {
        assert!(!compare_sound(&vec![0; 10_000], &vec![0; 20_000]).0);
        assert!(compare_sound(&vec![5; 10_000], &vec![5; 10_000]).0);
    }
}
