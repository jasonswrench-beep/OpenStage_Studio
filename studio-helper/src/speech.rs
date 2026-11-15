// SPDX-License-Identifier: Apache-2.0
//! Narration with the voices built into Windows.
//!
//! This is one of the narration engines OpenStage Studio can use. It runs on the computer, needs no download and sends
//! nothing anywhere. The same text and voice give the same sound every time, which a repeatable video needs.
//!
//! `speak --jobs <file>` reads `{"voice":"default","rate":1.0,"jobs":[{"text":"...","out":"clip.wav"}]}` and writes one WAV
//! file per job, saying `{"event":"spoken","out":...,"ms":...}` for each.

use crate::{arg, say};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct Jobs {
    #[serde(default)]
    voice: Option<String>,
    #[serde(default)]
    rate: Option<f64>,
    jobs: Vec<Job>,
}

#[derive(Deserialize)]
struct Job {
    text: String,
    out: String,
}

pub fn list_voices() -> Result<(), String> {
    let voices = imp::voices()?;
    let list: Vec<_> = voices.iter().map(|(name, lang, default)| json!({ "name": name, "language": lang, "default": default })).collect();
    say(json!({ "event": "voices", "voices": list }));
    Ok(())
}

pub fn run(args: &[String]) -> Result<(), String> {
    let path = arg(args, "--jobs").ok_or("Say where the list of lines is with --jobs.")?;
    let text = std::fs::read_to_string(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    let jobs: Jobs = serde_json::from_str(&text).map_err(|e| format!("The list of lines in {path} is not right: {e}"))?;
    let voice = jobs.voice.unwrap_or_else(|| "default".into());
    let rate = jobs.rate.unwrap_or(1.0).clamp(0.5, 2.0);
    let speaker = imp::Speaker::new(&voice, rate)?;
    say(json!({ "event": "voice", "name": speaker.name() }));
    for job in &jobs.jobs {
        let wav = speaker.speak(&job.text)?;
        let mono = crate::wav::parse_wav(&wav).map_err(|e| format!("Windows gave sound that could not be read: {e}"))?;
        let out = std::path::Path::new(&job.out);
        if let Some(dir) = out.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
        }
        std::fs::write(out, &wav).map_err(|e| format!("Could not save {}: {e}", out.display()))?;
        say(json!({ "event": "spoken", "out": job.out, "ms": crate::wav::duration_ms(&mono), "rate": mono.rate }));
    }
    Ok(())
}

#[cfg(windows)]
mod imp {
    use windows::core::HSTRING;
    use windows::Media::SpeechSynthesis::{SpeechSynthesizer, VoiceInformation};
    use windows::Storage::Streams::DataReader;

    pub fn voices() -> Result<Vec<(String, String, bool)>, String> {
        let all = SpeechSynthesizer::AllVoices().map_err(|e| format!("Windows could not list its voices: {e}"))?;
        let default = SpeechSynthesizer::DefaultVoice().ok().and_then(|v| v.Id().ok()).map(|s| s.to_string());
        let mut out = Vec::new();
        for v in all {
            let id = v.Id().map(|s| s.to_string()).unwrap_or_default();
            out.push((
                v.DisplayName().map(|s| s.to_string()).unwrap_or_default(),
                v.Language().map(|s| s.to_string()).unwrap_or_default(),
                Some(id) == default,
            ));
        }
        Ok(out)
    }

    pub struct Speaker {
        synth: SpeechSynthesizer,
        name: String,
    }

    impl Speaker {
        /// `voice` is `default` or part of a voice's name (capital letters do not matter).
        pub fn new(voice: &str, rate: f64) -> Result<Self, String> {
            let synth = SpeechSynthesizer::new().map_err(|e| format!("Windows speech could not start: {e}"))?;
            let chosen: Option<VoiceInformation> = if voice.eq_ignore_ascii_case("default") || voice.trim().is_empty() {
                None
            } else {
                let wanted = voice.to_lowercase();
                let all = SpeechSynthesizer::AllVoices().map_err(|e| format!("Windows could not list its voices: {e}"))?;
                let found = all.into_iter().find(|v| v.DisplayName().map(|n| n.to_string().to_lowercase().contains(&wanted)).unwrap_or(false));
                Some(found.ok_or_else(|| format!("No Windows voice is called \"{voice}\". The voices are listed by the voices command."))?)
            };
            if let Some(v) = &chosen {
                synth.SetVoice(v).map_err(|e| format!("Could not choose that voice: {e}"))?;
            }
            let options = synth.Options().map_err(|e| e.to_string())?;
            options.SetSpeakingRate(rate).map_err(|e| format!("Could not set the speaking rate: {e}"))?;
            let name = synth.Voice().and_then(|v| v.DisplayName()).map(|s| s.to_string()).unwrap_or_default();
            Ok(Self { synth, name })
        }

        pub fn name(&self) -> &str {
            &self.name
        }

        /// The sound of `text`, as the bytes of a WAV file.
        pub fn speak(&self, text: &str) -> Result<Vec<u8>, String> {
            let stream = self
                .synth
                .SynthesizeTextToStreamAsync(&HSTRING::from(text))
                .and_then(|op| op.join())
                .map_err(|e| format!("Windows could not speak \"{text}\": {e}"))?;
            let size = stream.Size().map_err(|e| e.to_string())? as u32;
            let input = stream.GetInputStreamAt(0).map_err(|e| e.to_string())?;
            let reader = DataReader::CreateDataReader(&input).map_err(|e| e.to_string())?;
            reader.LoadAsync(size).and_then(|op| op.join()).map_err(|e| format!("Could not read the speech: {e}"))?;
            let mut bytes = vec![0u8; size as usize];
            reader.ReadBytes(&mut bytes).map_err(|e| e.to_string())?;
            Ok(bytes)
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn voices() -> Result<Vec<(String, String, bool)>, String> {
        Err("Windows voices are only on Windows.".into())
    }
    pub struct Speaker;
    impl Speaker {
        pub fn new(_: &str, _: f64) -> Result<Self, String> {
            Err("Windows voices are only on Windows.".into())
        }
        pub fn name(&self) -> &str {
            ""
        }
        pub fn speak(&self, _: &str) -> Result<Vec<u8>, String> {
            Err("Windows voices are only on Windows.".into())
        }
    }
}
