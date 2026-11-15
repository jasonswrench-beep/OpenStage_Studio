// SPDX-License-Identifier: Apache-2.0
//! Narration with Kokoro-82M, a local speech model, run inside the helper.
//!
//! * The model (Apache-2.0) is the ONNX build of Kokoro-82M 1.0, pinned to one revision and checked by its SHA-256 when it
//!   is downloaded (`tools/kokoro-model.json`). It runs with ONNX Runtime (MIT), on the processor, offline.
//! * Words become sounds through misaki-rs (MIT), a Rust port of Kokoro's own dictionary front end, built without its
//!   GPL fallback. Words that are not in its dictionary go through [`WordFallback`] below, which is ours: it splits joined
//!   words, takes off common endings, and spells out what is left letter by letter. Studio's pronunciation list handles
//!   names before any of this, so a product name is said the way the project says it.
//! * The same text and voice give the same sound every time: nothing here draws random numbers, and the model is run with
//!   one thread so its sums are always added in the same order.

use misaki_rs::fallback::FallbackError;
use misaki_rs::{Fallback, Language, G2P};
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Tensor;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// The sound rate Kokoro makes.
pub const SAMPLE_RATE: u32 = 24_000;
/// The most phoneme tokens Kokoro takes at once (its voice files hold a style for each length up to this).
const MAX_TOKENS: usize = 510;
const STYLE: usize = 256;

/// Where the downloaded model lives unless told otherwise: the user's local app data, one folder per pinned revision.
pub fn default_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join("OpenStage Studio").join("voices").join("kokoro-82m-1939ad2")
}

pub struct Kokoro {
    session: Session,
    vocab: HashMap<char, i64>,
    voice: Vec<f32>,
    g2p: G2P,
    pub voice_name: String,
}

impl Kokoro {
    /// Load the model from `dir` with the voice called `voice` (such as `af_heart`).
    pub fn load(dir: &Path, voice: &str) -> Result<Self, String> {
        let model = dir.join("onnx").join("model.onnx");
        if !model.is_file() {
            return Err(format!(
                "The Kokoro voice is not downloaded yet (looked in {}). Run \"Get Voice.bat\" first.",
                dir.display()
            ));
        }
        if !voice.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') || voice.is_empty() {
            return Err(format!("\"{voice}\" is not the name of a Kokoro voice."));
        }
        let voice_file = dir.join("voices").join(format!("{voice}.bin"));
        let bytes = std::fs::read(&voice_file).map_err(|_| format!("The Kokoro voice \"{voice}\" is not downloaded (no {}).", voice_file.display()))?;
        if bytes.len() != MAX_TOKENS * STYLE * 4 {
            return Err(format!("The voice file {} is not the right size; download it again.", voice_file.display()));
        }
        let voice_data = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        let vocab = read_vocab(&dir.join("tokenizer.json"))?;
        let session = open_session(&model).map_err(|e| format!("The Kokoro model could not be loaded: {e}"))?;
        let g2p = G2P::with_fallback(Language::EnglishUS, Some(Box::new(WordFallback::new())));
        Ok(Self { session, vocab, voice: voice_data, g2p, voice_name: voice.to_string() })
    }

    /// The phonemes Kokoro will say for `text`.
    pub fn phonemes(&self, text: &str) -> Result<String, String> {
        let (p, _) = self.g2p.g2p(text).map_err(|e| format!("Could not work out how to say \"{text}\": {e}"))?;
        Ok(p)
    }

    /// The sound of `text`, at [`SAMPLE_RATE`], as numbers from -1 to 1.
    pub fn speak(&mut self, text: &str, speed: f32) -> Result<Vec<f32>, String> {
        let phonemes = self.phonemes(text)?;
        let ids: Vec<i64> = phonemes.chars().filter_map(|c| self.vocab.get(&c).copied()).collect();
        let mut out = Vec::new();
        for chunk in split_tokens(&ids, &phonemes, &self.vocab) {
            if chunk.is_empty() {
                continue;
            }
            let n = chunk.len();
            let mut input = Vec::with_capacity(n + 2);
            input.push(0);
            input.extend_from_slice(&chunk);
            input.push(0);
            let style = self.voice[n * STYLE..(n + 1) * STYLE].to_vec();
            let input_ids = Tensor::from_array(([1usize, n + 2], input)).map_err(|e| e.to_string())?;
            let style = Tensor::from_array(([1usize, STYLE], style)).map_err(|e| e.to_string())?;
            let speed = Tensor::from_array(([1usize], vec![speed])).map_err(|e| e.to_string())?;
            let outputs = self
                .session
                .run(ort::inputs!["input_ids" => input_ids, "style" => style, "speed" => speed])
                .map_err(|e| format!("Kokoro could not speak \"{text}\": {e}"))?;
            let (_, data) = outputs[0].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
            out.extend_from_slice(data);
        }
        Ok(out)
    }
}

/// ONNX Runtime on the processor, one thread, so the same input always gives the same sound.
fn open_session(model: &Path) -> Result<Session, String> {
    let env = ort::init().build().map_err(|e| e.to_string())?;
    let builder = Session::builder(&env).map_err(|e| e.to_string())?;
    let builder = builder.with_optimization_level(GraphOptimizationLevel::Level3).map_err(|e| e.to_string())?;
    let builder = builder.with_intra_threads(1).map_err(|e| e.to_string())?;
    let builder = builder.with_inter_threads(1).map_err(|e| e.to_string())?;
    let mut builder = builder;
    builder.commit_from_file(model).map_err(|e| e.to_string())
}

/// The phoneme-to-number table in the model's tokenizer.json.
fn read_vocab(path: &Path) -> Result<HashMap<char, i64>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("{} is not right: {e}", path.display()))?;
    let vocab = json["model"]["vocab"].as_object().ok_or_else(|| format!("{} has no vocabulary.", path.display()))?;
    let mut map = HashMap::new();
    for (k, v) in vocab {
        let mut chars = k.chars();
        if let (Some(c), None, Some(id)) = (chars.next(), chars.next(), v.as_i64()) {
            map.insert(c, id);
        }
    }
    Ok(map)
}

/// Split a long line into pieces Kokoro can take, at the last sentence or clause end before the limit.
fn split_tokens(ids: &[i64], phonemes: &str, vocab: &HashMap<char, i64>) -> Vec<Vec<i64>> {
    if ids.len() <= MAX_TOKENS {
        return vec![ids.to_vec()];
    }
    let breaks: Vec<i64> = ['.', '!', '?', ';', ':', ','].iter().filter_map(|c| vocab.get(c).copied()).collect();
    let space = vocab.get(&' ').copied();
    let _ = phonemes;
    let mut out = Vec::new();
    let mut start = 0;
    while ids.len() - start > MAX_TOKENS {
        let window = &ids[start..start + MAX_TOKENS];
        let cut = window
            .iter()
            .rposition(|t| breaks.contains(t))
            .or_else(|| window.iter().rposition(|t| Some(*t) == space))
            .map(|i| i + 1)
            .unwrap_or(MAX_TOKENS);
        out.push(ids[start..start + cut].to_vec());
        start += cut;
    }
    out.push(ids[start..].to_vec());
    out
}

/// Ways to say a word the dictionary does not know, with nothing GPL in them.
pub struct WordFallback {
    inner: G2P,
}

/// How each letter's name is said, in Kokoro's phonemes.
const LETTERS: [&str; 26] = [
    "ˈA", "bˈi", "sˈi", "dˈi", "ˈi", "ˈɛf", "ʤˈi", "ˈAʧ", "ˈI", "ʤˈA", "kˈA", "ˈɛl", "ˈɛm", "ˈɛn", "ˈO", "pˈi", "kjˈu",
    "ˈɑɹ", "ˈɛs", "tˈi", "jˈu", "vˈi", "dˈʌbᵊljˌu", "ˈɛks", "wˈI", "zˈi",
];

impl WordFallback {
    pub fn new() -> Self {
        Self { inner: G2P::with_fallback(Language::EnglishUS, None) }
    }

    /// The dictionary's phonemes for a word, if it knows it.
    fn known(&self, word: &str) -> Option<String> {
        if word.is_empty() || !word.chars().all(|c| c.is_alphabetic() || c == '\'') {
            return None;
        }
        let (p, _) = self.inner.g2p(word).ok()?;
        let p = p.trim().to_string();
        (!p.is_empty() && !p.contains(&self.inner.unk)).then_some(p)
    }

    /// Spell a word out, letter by letter.
    fn spell(word: &str) -> String {
        word.chars()
            .filter_map(|c| c.to_ascii_uppercase().is_ascii_uppercase().then(|| LETTERS[(c.to_ascii_uppercase() as u8 - b'A') as usize]))
            .collect::<Vec<_>>()
            .join(" ")
    }

    pub fn say(&self, word: &str) -> String {
        // Short words in capitals are initials: say the letters.
        let letters: String = word.chars().filter(|c| c.is_alphabetic()).collect();
        if letters.len() <= 4 && letters.chars().all(|c| c.is_ascii_uppercase()) {
            return Self::spell(&letters);
        }
        // Joined words in mixed case (OpenStage): each part on its own.
        let parts = camel_parts(word);
        if parts.len() > 1 {
            let said: Vec<String> = parts.iter().map(|p| self.known(p).unwrap_or_else(|| self.say(p))).collect();
            return said.join(" ");
        }
        let lower = word.to_lowercase();
        // Two known words written as one (lessonplan).
        for cut in (2..lower.len().saturating_sub(1)).rev() {
            if !lower.is_char_boundary(cut) {
                continue;
            }
            if let (Some(a), Some(b)) = (self.known(&lower[..cut]), self.known(&lower[cut..])) {
                return format!("{a} {b}");
            }
        }
        // A known word with an ending added.
        for (ending, sound) in [("ing", "ɪŋ"), ("ers", "əɹz"), ("er", "əɹ"), ("ed", "d"), ("es", "z"), ("s", "z"), ("ly", "li")] {
            if let Some(stem) = lower.strip_suffix(ending) {
                if let Some(p) = self.known(stem) {
                    return format!("{p}{sound}");
                }
            }
        }
        Self::spell(&letters)
    }
}

impl Default for WordFallback {
    fn default() -> Self {
        Self::new()
    }
}

impl Fallback for WordFallback {
    fn phonemize(&self, word: &str) -> Result<String, FallbackError> {
        let said = self.say(word);
        if said.is_empty() {
            Err(FallbackError::NoPhonemes { word: word.to_string() })
        } else {
            Ok(said)
        }
    }
}

/// Split `OpenStageStudio` into `Open`, `Stage`, `Studio`; a run of capitals stays together (`HTMLEditor` gives `HTML`, `Editor`).
fn camel_parts(word: &str) -> Vec<String> {
    let chars: Vec<char> = word.chars().collect();
    let mut parts = Vec::new();
    let mut current = String::new();
    for i in 0..chars.len() {
        let c = chars[i];
        let starts_new = i > 0
            && c.is_uppercase()
            && (chars[i - 1].is_lowercase() || chars.get(i + 1).is_some_and(|n| n.is_lowercase()) && chars[i - 1].is_uppercase());
        if starts_new && !current.is_empty() {
            parts.push(std::mem::take(&mut current));
        }
        current.push(c);
    }
    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joined_words_are_split_where_the_case_changes() {
        assert_eq!(camel_parts("OpenStage"), vec!["Open", "Stage"]);
        assert_eq!(camel_parts("HTMLEditor"), vec!["HTML", "Editor"]);
        assert_eq!(camel_parts("lesson"), vec!["lesson"]);
    }

    #[test]
    fn unknown_words_are_said_with_no_unknown_marker() {
        let f = WordFallback::new();
        for w in ["OpenStage", "QDA", "lessonplanner", "zxqv"] {
            let said = f.say(w);
            assert!(!said.is_empty() && !said.contains('❓'), "{w}: {said}");
        }
        assert_eq!(f.say("QDA"), "kjˈu dˈi ˈA");
    }

    #[test]
    fn a_long_line_is_split_at_a_clause_end() {
        let mut vocab = HashMap::new();
        vocab.insert(',', 3);
        vocab.insert(' ', 16);
        let mut ids = vec![50i64; 300];
        ids.push(3);
        ids.extend(vec![50i64; 300]);
        let parts = split_tokens(&ids, "", &vocab);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].len(), 301);
        assert!(parts.iter().all(|p| p.len() <= MAX_TOKENS));
    }
}
