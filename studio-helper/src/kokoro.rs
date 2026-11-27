// SPDX-License-Identifier: Apache-2.0
//! Narration with Kokoro-82M, a local speech model, run inside the helper.
//!
//! * The model (Apache-2.0) is the ONNX build of Kokoro-82M 1.0, pinned to one revision and checked by its SHA-256 when it
//!   is downloaded (`tools/kokoro-model.json`). It runs with ONNX Runtime (MIT), offline: on the processor while the
//!   computer is quiet, and on the graphics card while other work is running: through CUDA when NVIDIA's CUDA runtime
//!   and cuDNN are on the computer (they are not part of Studio), else through DirectML, which comes with Windows. CUDA
//!   gives the processor's voice; DirectML's is a little softer. See [`open_session`] and docs/voice-models.md.
//! * Words become sounds through misaki-rs (MIT), a Rust port of Kokoro's own dictionary front end, built without its
//!   GPL fallback. Words that are not in its dictionary go through [`WordFallback`] below, which is ours: it says letters
//!   and digits written together piece by piece (F6, INT-01), takes off common endings, splits joined words, sounds out a
//!   name from its spelling ([`sound_out`]), and spells out only what is left, such as initials. Studio's pronunciation
//!   list handles names before any of this, so a product name is said the way the project says it.
//! * Before the dictionary sees the text, a number with a decimal point keeps every digit it is written with
//!   ([`say_decimals`]): "51.50" is "51 point five zero", where the dictionary alone said "fifty one point five".
//! * The same text and voice give the same sound every time on the same computer: nothing here draws random numbers, and
//!   the model is run with one thread (on the graphics card, one stream) so its sums are always added in the same order.

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

/// Where the model runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Device {
    /// An NVIDIA card through CUDA, when its runtime and cuDNN can be found.
    Cuda,
    /// Any DirectX 12 card through DirectML, part of Windows.
    DirectMl,
    Processor,
}

impl Device {
    pub fn describe(self) -> &'static str {
        match self {
            Device::Cuda => "the graphics card (CUDA)",
            Device::DirectMl => "the graphics card (DirectML)",
            Device::Processor => "the processor",
        }
    }

    fn on_card(self) -> bool {
        self != Device::Processor
    }
}

pub struct Kokoro {
    session: Session,
    model: PathBuf,
    vocab: HashMap<char, i64>,
    voice: Vec<f32>,
    g2p: G2P,
    pub voice_name: String,
    /// Where the model runs now.
    pub device: Device,
    /// Why it is not on the graphics card, when it was meant to be.
    pub fallback: Option<String>,
}

impl Kokoro {
    /// Load the model from `dir` with the voice called `voice` (such as `af_heart`), on the graphics card if one takes it.
    pub fn load(dir: &Path, voice: &str) -> Result<Self, String> {
        Self::open(dir, voice, true)
    }

    /// Load it on the processor only: for working out phonemes, which needs no graphics card.
    pub fn load_on_processor(dir: &Path, voice: &str) -> Result<Self, String> {
        Self::open(dir, voice, false)
    }

    fn open(dir: &Path, voice: &str, graphics_card: bool) -> Result<Self, String> {
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
        let voice_data: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        let vocab = read_vocab(&dir.join("tokenizer.json"))?;
        let (session, device, fallback) = if graphics_card { open_session(&model, &vocab, &voice_data)? } else { processor(&model, None)? };
        let g2p = G2P::with_fallback(Language::EnglishUS, Some(Box::new(WordFallback::new())));
        Ok(Self { session, model, vocab, voice: voice_data, g2p, voice_name: voice.to_string(), device, fallback })
    }

    /// The phonemes Kokoro will say for `text`.
    pub fn phonemes(&self, text: &str) -> Result<String, String> {
        let (p, _) = self.g2p.g2p(&say_decimals(text)).map_err(|e| format!("Could not work out how to say \"{text}\": {e}"))?;
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
            let said = match run_model(&mut self.session, &chunk, &self.voice, speed) {
                Ok(s) => Ok(s),
                // The graphics card failed part way: say the rest on the processor, which gives the same voice.
                Err(e) if self.device.on_card() => {
                    let (s, d, _) = processor(&self.model, None)?;
                    self.session = s;
                    self.device = d;
                    self.fallback = Some(format!("the graphics card stopped: {e}"));
                    run_model(&mut self.session, &chunk, &self.voice, speed)
                }
                Err(e) => Err(e),
            }
            .map_err(|e| format!("Kokoro could not speak \"{text}\": {e}"))?;
            out.extend_from_slice(&said);
        }
        Ok(out)
    }
}

/// One piece of phoneme tokens through the model.
fn run_model(session: &mut Session, chunk: &[i64], voice: &[f32], speed: f32) -> Result<Vec<f32>, String> {
    let n = chunk.len();
    let mut input = Vec::with_capacity(n + 2);
    input.push(0);
    input.extend_from_slice(chunk);
    input.push(0);
    let style = voice[n * STYLE..(n + 1) * STYLE].to_vec();
    let input_ids = Tensor::from_array(([1usize, n + 2], input)).map_err(|e| e.to_string())?;
    let style = Tensor::from_array(([1usize, STYLE], style)).map_err(|e| e.to_string())?;
    let speed = Tensor::from_array(([1usize], vec![speed])).map_err(|e| e.to_string())?;
    let outputs = session.run(ort::inputs!["input_ids" => input_ids, "style" => style, "speed" => speed]).map_err(|e| e.to_string())?;
    let (_, data) = outputs[0].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
    Ok(data.to_vec())
}

/// The model on the graphics card when one takes it and says a test word there, else on the processor; with the reason
/// it is not on the graphics card, when it was meant to be.
///
/// Which, by OPENSTAGE_VOICE_DEVICE: `processor`, `cuda`, `directml`, `graphics-card` (CUDA, else DirectML), or `auto`, the
/// default: the processor while the computer is quiet, and the graphics card while other work is using a tenth of the
/// processor or more, so a long narration does not slow everything else (Jason, 2026-11-26): CUDA where NVIDIA's files
/// are, else DirectML, so an installed Studio, which carries no NVIDIA files, still takes the card (Jason, 2026-11-27:
/// DirectML only "BARELY softer" to his ears; docs/voice-models.md).
fn open_session(model: &Path, vocab: &HashMap<char, i64>, voice: &[f32]) -> Result<(Session, Device, Option<String>), String> {
    let wanted = std::env::var("OPENSTAGE_VOICE_DEVICE").map(|v| v.to_ascii_lowercase()).unwrap_or_default();
    let cards = cards_to_try(&wanted, processor_busy);
    let mut why = Vec::new();
    for &card in cards {
        match session_on(model, card) {
            Ok(mut s) => {
                let test: Vec<i64> = "həlˈO".chars().filter_map(|c| vocab.get(&c).copied()).collect();
                match run_model(&mut s, &test, voice, 1.0) {
                    Ok(_) => return Ok((s, card, None)),
                    Err(e) => why.push(format!("{} could not run the voice: {e}", card.describe())),
                }
            }
            Err(e) => why.push(format!("{} did not take the voice: {e}", card.describe())),
        }
    }
    processor(model, (!why.is_empty()).then(|| why.join("; ")))
}

/// The share of the processor other work uses at or above which the voice goes to the graphics card.
const BUSY: f64 = 0.10;

/// The cards to try, in order, for what OPENSTAGE_VOICE_DEVICE asks (none: the processor); `busy` is asked only for `auto`.
fn cards_to_try(wanted: &str, busy: impl FnOnce() -> Option<f64>) -> &'static [Device] {
    match wanted {
        "processor" | "cpu" => &[],
        "cuda" => &[Device::Cuda],
        "directml" => &[Device::DirectMl],
        "graphics-card" | "gpu" => &[Device::Cuda, Device::DirectMl],
        _ => match busy() {
            Some(b) if b >= BUSY => &[Device::Cuda, Device::DirectMl],
            _ => &[],
        },
    }
}

/// How much of the processor is in use now, from 0 to 1, over a quarter of a second.
#[cfg(windows)]
pub fn processor_busy() -> Option<f64> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::GetSystemTimes;
    let read = || -> Option<(u64, u64, u64)> {
        let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
        // SAFETY: three FILETIMEs of our own for Windows to fill in.
        unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }.ok()?;
        let n = |t: FILETIME| ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64;
        Some((n(idle), n(kernel), n(user)))
    };
    let (i0, k0, u0) = read()?;
    std::thread::sleep(std::time::Duration::from_millis(250));
    let (i1, k1, u1) = read()?;
    // The kernel's time includes the idle time.
    let total = (k1 - k0) + (u1 - u0);
    (total > 0).then(|| 1.0 - (i1 - i0) as f64 / total as f64)
}

#[cfg(not(windows))]
pub fn processor_busy() -> Option<f64> {
    None
}

fn processor(model: &Path, why: Option<String>) -> Result<(Session, Device, Option<String>), String> {
    let s = session_on(model, Device::Processor).map_err(|e| format!("The Kokoro model could not be loaded: {e}"))?;
    Ok((s, Device::Processor, why))
}

/// ONNX Runtime with one thread, so the same input always gives the same sound. On CUDA with full 32-bit sums (no TF32)
/// and only the kernels that give the same result every time; on DirectML with one stream and no memory pattern, on the
/// fastest card rather than a processor's built-in graphics.
fn session_on(model: &Path, device: Device) -> Result<Session, String> {
    let builder = Session::builder(environment()?).map_err(|e| e.to_string())?;
    let builder = builder.with_optimization_level(GraphOptimizationLevel::Level3).map_err(|e| e.to_string())?;
    let builder = builder.with_intra_threads(1).map_err(|e| e.to_string())?;
    let builder = builder.with_inter_threads(1).map_err(|e| e.to_string())?;
    let mut builder = match device {
        Device::Cuda => {
            cuda_libraries();
            let b = builder.with_deterministic_compute(true).map_err(|e| e.to_string())?;
            let cuda = ort::ep::CUDA::default().with_tf32(false).with_conv_algorithm_search(ort::ep::cuda::ConvAlgorithmSearch::Default);
            b.with_execution_providers([cuda.build().error_on_failure()]).map_err(|e| e.to_string())?
        }
        Device::DirectMl => {
            let b = builder.with_memory_pattern(false).map_err(|e| e.to_string())?;
            let b = b.with_parallel_execution(false).map_err(|e| e.to_string())?;
            let dml = ort::ep::DirectML::default()
                .with_performance_preference(ort::ep::directml::PerformancePreference::HighPerformance)
                .with_device_filter(ort::ep::directml::DeviceFilter::Gpu);
            b.with_execution_providers([dml.build().error_on_failure()]).map_err(|e| e.to_string())?
        }
        Device::Processor => builder,
    };
    builder.commit_from_file(model).map_err(|e| e.to_string())
}

/// ONNX Runtime's environment, made once and kept: ort allows one per process, so a card that does not take the voice
/// must not use it up before the next card or the processor is tried ("only one environment is allowed per process").
fn environment() -> Result<&'static ort::environment::Environment, String> {
    static ENV: std::sync::OnceLock<ort::environment::Environment> = std::sync::OnceLock::new();
    if let Some(env) = ENV.get() {
        return Ok(env);
    }
    let env = ort::init().build().map_err(|e| e.to_string())?;
    Ok(ENV.get_or_init(|| env))
}

/// Where the CUDA runtime and cuDNN are looked for besides Windows' usual places: OPENSTAGE_CUDA_DIR, else
/// %LOCALAPPDATA%\openstage-cuda-trial\bin. They are NVIDIA's, under NVIDIA's licences, and not part of Studio.
fn cuda_libraries() {
    let dir = std::env::var_os("OPENSTAGE_CUDA_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(|l| PathBuf::from(l).join("openstage-cuda-trial").join("bin")));
    if let Some(dir) = dir.filter(|d| d.is_dir()) {
        let path = std::env::var_os("PATH").unwrap_or_default();
        if !std::env::split_paths(&path).any(|p| p == dir) {
            let joined = std::env::join_paths(std::iter::once(dir).chain(std::env::split_paths(&path))).unwrap_or(path);
            // Set before the CUDA libraries load, and before any thread of the helper's own reads the environment.
            std::env::set_var("PATH", joined);
        }
    }
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

const DIGITS: [&str; 10] = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/// "point" as the dictionary says it in a number (not stressed), given as sounds under a word the dictionary does not know,
/// so that it takes the sounds.
const POINT: &str = "[decimalpoint](/pYnt/)";

/// A number with a decimal point that the dictionary would cut short, written out so that every digit after the point is
/// said: "51.50" becomes "51 point five zero" ("fifty one point five" otherwise), "2.0" "2 point zero" ("two" otherwise)
/// and "1.1's" "1 point one's" (only "s" otherwise). Every other number is left to the dictionary, which says it right
/// ("1.2" is "one point two"), as are money ($51.50 is "fifty one dollars and fifty cents"), numbers with more than one
/// point (1.1.1) and codes (1.5x, v1.2).
pub fn say_decimals(text: &str) -> String {
    let c: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len() + 16);
    let mut i = 0;
    while i < c.len() {
        let starts = c[i].is_ascii_digit() && (i == 0 || !(c[i - 1].is_alphanumeric() || c[i - 1] == '.' || c[i - 1] == ','));
        if !starts {
            out.push(c[i]);
            i += 1;
            continue;
        }
        // The whole number: digits, with commas between digits.
        let mut j = i;
        while j < c.len() && (c[j].is_ascii_digit() || (c[j] == ',' && j > i && j + 1 < c.len() && c[j + 1].is_ascii_digit())) {
            j += 1;
        }
        let money = i > 0 && matches!(c[i - 1], '$' | '£' | '€' | '¥');
        if !money && j + 1 < c.len() && c[j] == '.' && c[j + 1].is_ascii_digit() {
            let mut k = j + 1;
            while k < c.len() && c[k].is_ascii_digit() {
                k += 1;
            }
            let more = k < c.len() && (c[k].is_alphanumeric() || (c[k] == '.' && k + 1 < c.len() && c[k + 1].is_ascii_digit()));
            let cut_short = c[k - 1] == '0' || (k < c.len() && matches!(c[k], '\'' | '’'));
            if !more && !cut_short {
                out.extend(&c[i..k]);
                i = k;
                continue;
            }
            if !more {
                out.extend(&c[i..j]);
                out.push(' ');
                out.push_str(POINT);
                for d in &c[j + 1..k] {
                    out.push(' ');
                    out.push_str(DIGITS[d.to_digit(10).unwrap_or(0) as usize]);
                }
                i = k;
                continue;
            }
            // A version or a code: as it is, every piece of it.
            let mut m = k;
            while m < c.len() && (c[m].is_alphanumeric() || (c[m] == '.' && m + 1 < c.len() && c[m + 1].is_alphanumeric())) {
                m += 1;
            }
            out.extend(&c[i..m]);
            i = m;
            continue;
        }
        out.extend(&c[i..j]);
        i = j;
    }
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

/// Words of two letters that end joined words (plugin, setup, login, addon).
const SHORT_ENDS: [&str; 6] = ["in", "up", "on", "at", "by", "to"];

/// An s alone after the apostrophe at `i` (1's), not the start of a longer word.
fn at_s(c: &[char], i: usize) -> bool {
    c.get(i + 1).is_some_and(|&s| s == 's' || s == 'S') && !c.get(i + 2).is_some_and(|n| n.is_alphabetic())
}

/// Short names of keys, said as the key's whole name.
const KEYS: [(&str, &str); 5] = [("ctrl", "control"), ("esc", "escape"), ("del", "delete"), ("pgup", "page up"), ("pgdn", "page down")];

impl WordFallback {
    pub fn new() -> Self {
        Self { inner: G2P::with_fallback(Language::EnglishUS, None) }
    }

    /// The dictionary's phonemes for a word (or words), if it knows it.
    fn known(&self, word: &str) -> Option<String> {
        if word.is_empty() || !word.chars().all(|c| c.is_alphabetic() || c == '\'' || c == ' ') {
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

    fn digit_by_digit(&self, d: &str) -> String {
        d.chars().filter_map(|c| c.to_digit(10)).filter_map(|n| self.known(DIGITS[n as usize])).collect::<Vec<_>>().join(" ")
    }

    /// Digits written in a word: as a number (F6 "F six", F10 "F ten"), or one by one after letters when there are more
    /// than two or the first is a zero (P07 "P zero seven", H.264 "H two six four").
    fn digits(&self, d: &str, after_letters: bool) -> String {
        if (after_letters && (d.len() > 2 || d.starts_with('0'))) || d.len() > 4 {
            return self.digit_by_digit(d);
        }
        match self.inner.g2p(d) {
            Ok((p, _)) if !p.trim().is_empty() && !p.contains(&self.inner.unk) => p.trim().to_string(),
            _ => self.digit_by_digit(d),
        }
    }

    /// A word with digits or marks in it (F6, INT-01, Shift+F6, cmi5, H.264): each run of letters and of digits on its
    /// own, a plus as "plus", and any other mark only a break.
    fn pieces(&self, word: &str) -> String {
        let c: Vec<char> = word.chars().collect();
        let mut out = Vec::new();
        let mut after_letters = false;
        let mut i = 0;
        while i < c.len() {
            if c[i].is_alphabetic() {
                let s = i;
                while i < c.len() && (c[i].is_alphabetic() || (c[i] == '\'' && i + 1 < c.len() && c[i + 1].is_alphabetic())) {
                    i += 1;
                }
                let w: String = c[s..i].iter().collect();
                out.push(if w.chars().count() == 1 { Self::spell(&w) } else { self.known(&w).unwrap_or_else(|| self.say(&w)) });
                after_letters = true;
            } else if c[i].is_ascii_digit() {
                let s = i;
                while i < c.len() && c[i].is_ascii_digit() {
                    i += 1;
                }
                let d: String = c[s..i].iter().collect();
                out.push(self.digits(&d, after_letters));
                after_letters = false;
            } else if matches!(c[i], '\'' | '’') && at_s(&c, i) && !out.is_empty() {
                // 1's: the s is said with what comes before it.
                if let Some(last) = out.last_mut() {
                    last.push('z');
                }
                i += 2;
            } else {
                if c[i] == '+' {
                    out.extend(self.known("plus"));
                }
                i += 1;
            }
        }
        out.retain(|p| !p.is_empty());
        out.join(" ")
    }

    pub fn say(&self, word: &str) -> String {
        if let Some((_, name)) = KEYS.iter().find(|(k, _)| word.eq_ignore_ascii_case(k)) {
            if let Some(p) = self.known(name) {
                return p;
            }
        }
        if word.chars().any(|c| !(c.is_alphabetic() || c == '\'')) {
            return self.pieces(word);
        }
        // Short words in capitals are initials: say the letters.
        let letters: String = word.chars().filter(|c| c.is_alphabetic()).collect();
        if letters.chars().count() <= 4 && letters.chars().all(|c| c.is_ascii_uppercase()) {
            return Self::spell(&letters);
        }
        // Joined words in mixed case (OpenStage): each part on its own.
        let parts = camel_parts(word);
        if parts.len() > 1 {
            let said: Vec<String> = parts.iter().map(|p| self.known(p).unwrap_or_else(|| self.say(p))).collect();
            return said.join(" ");
        }
        let lower = word.to_lowercase();
        // A known word with an ending added (copied is copy with -ed): before splitting, so it is not "co pied".
        let endings = [("ied", "y", "d"), ("ies", "y", "z"), ("ing", "", "ɪŋ"), ("ers", "", "əɹz"), ("er", "", "əɹ"), ("ed", "", "d"), ("es", "", "z"), ("s", "", "z"), ("ly", "", "li")];
        for (ending, stem_end, sound) in endings {
            if let Some(stem) = lower.strip_suffix(ending) {
                if let Some(p) = self.known(&format!("{stem}{stem_end}")) {
                    return format!("{p}{sound}");
                }
            }
        }
        // Two known words written as one (lessonplan, plugin): the second of three letters or more, or a short word that
        // ends such words, so that a name (Samira) is not cut into pieces that happen to be words.
        for cut in (2..lower.len().saturating_sub(1)).rev() {
            if !lower.is_char_boundary(cut) || (lower.len() - cut < 3 && !SHORT_ENDS.contains(&&lower[cut..])) {
                continue;
            }
            if let (Some(a), Some(b)) = (self.known(&lower[..cut]), self.known(&lower[cut..])) {
                return format!("{a} {b}");
            }
        }
        // A name, said from its spelling.
        if let Some(p) = sound_out(word) {
            return p;
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

/// The consonants an English word can begin with, for telling a word in small letters that can be sounded out (vivo) from
/// one that is letters (cmi, img).
const ONSETS: [&str; 40] = [
    "bl", "br", "ch", "chr", "cl", "cr", "dr", "dw", "fl", "fr", "gl", "gr", "kl", "kn", "kr", "ph", "pl", "pr", "qu", "sc",
    "sch", "scr", "sh", "sk", "sl", "sm", "sn", "sp", "spl", "spr", "squ", "st", "str", "sw", "th", "thr", "tr", "tw", "wh", "wr",
];

/// One sound of a word being sounded out: consonants, and whether they close the syllable before them as two consonants do
/// (a doubled letter, ck, x); or a vowel, with how it is said in an open syllable, in a closed one and before an r that
/// ends its syllable (`fixed` when it is said one way whatever follows).
#[derive(Clone, Copy, Debug)]
enum Unit {
    Consonant(&'static str, bool),
    Vowel { open: &'static str, closed: &'static str, before_r: &'static str, fixed: bool },
}

fn is_vowel(c: char) -> bool {
    matches!(c, 'a' | 'e' | 'i' | 'o' | 'u' | 'y')
}

fn is_plain_vowel(c: char) -> bool {
    matches!(c, 'a' | 'e' | 'i' | 'o' | 'u')
}

/// A name (or a word in small letters of four or more) said from its spelling, the way an English speaker reads an
/// unfamiliar name: Priya "pɹˈijə", Delgado "dəlɡˈɑdO", Theo "θˈiO", Mei "mˈA". The stress is on the first syllable, or on
/// the last but one in a word of three or more that ends in a vowel. None for initials and for what cannot be said as one
/// word (no vowel, or small letters that begin like no English word).
pub fn sound_out(word: &str) -> Option<String> {
    let folded: String = word
        .chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            'À' | 'Á' | 'Â' | 'Ä' => 'A',
            'É' | 'È' => 'E',
            c => c,
        })
        .filter(|&c| c != '\'')
        .collect();
    let first = folded.chars().next()?;
    if !folded.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let capitalised = first.is_ascii_uppercase() && folded.chars().skip(1).all(|c| c.is_ascii_lowercase());
    let small = folded.chars().all(|c| c.is_ascii_lowercase());
    if !(capitalised || small) {
        return None;
    }
    let w: Vec<char> = folded.to_ascii_lowercase().chars().collect();
    if !w.iter().any(|&c| is_vowel(c)) {
        return None;
    }
    if small {
        let onset: String = w.iter().take_while(|&&c| !is_plain_vowel(c)).collect();
        if w.len() < 4 || (onset.len() > 1 && !ONSETS.contains(&onset.as_str())) {
            return None;
        }
    }
    let units = units(&w);
    let vowels: Vec<usize> = units.iter().enumerate().filter(|(_, u)| matches!(u, Unit::Vowel { .. })).map(|(i, _)| i).collect();
    if vowels.is_empty() {
        return None;
    }
    let ends_in_vowel = matches!(units.last(), Some(Unit::Vowel { .. }));
    let stressed = if vowels.len() >= 3 && ends_in_vowel { vowels[vowels.len() - 2] } else { vowels[0] };
    let mut out = String::new();
    let mut i = 0;
    while i < units.len() {
        match units[i] {
            Unit::Consonant(p, _) => out.push_str(p),
            Unit::Vowel { open, closed, before_r, fixed } => {
                let next = units.get(i + 1).copied();
                let after = units.get(i + 2).copied();
                // An r that ends the syllable (Akafer, Likert) colours the vowel and is said with it.
                let r_closes = matches!(next, Some(Unit::Consonant("ɹ", _))) && !matches!(after, Some(Unit::Vowel { .. }));
                let mut sound = if fixed {
                    open
                } else if r_closes {
                    before_r
                } else {
                    match (next, after) {
                        (None, _) | (Some(Unit::Vowel { .. }), _) => open,
                        (Some(Unit::Consonant(_, false)), Some(Unit::Vowel { .. })) => open,
                        _ => closed,
                    }
                };
                if i == stressed {
                    out.push('ˈ');
                } else {
                    sound = match sound {
                        "æ" | "ɛ" | "ʌ" => "ə",
                        "ɑ" if !fixed => "ə",
                        "ɜɹ" => "əɹ",
                        s => s,
                    };
                }
                out.push_str(sound);
                if r_closes {
                    i += 1;
                }
            }
        }
        i += 1;
    }
    Some(out)
}

/// The sounds of a word in small letters, in order.
fn units(w: &[char]) -> Vec<Unit> {
    let n = w.len();
    let at = |i: usize| w.get(i).copied();
    let starts = |i: usize, s: &str| s.chars().enumerate().all(|(k, c)| at(i + k) == Some(c));
    let vowel_after = |i: usize| at(i).is_some_and(is_plain_vowel);
    let vowel = |open, closed, before_r| Unit::Vowel { open, closed, before_r, fixed: false };
    let fixed = |sound| Unit::Vowel { open: sound, closed: sound, before_r: sound, fixed: true };
    // A final e after one consonant, with a vowel before them, is not said (Rafe), and makes that vowel long.
    let silent_e = n > 2 && w[n - 1] == 'e' && !is_vowel(w[n - 2]) && w[..n - 2].iter().any(|&c| is_vowel(c));
    let mut out = Vec::new();
    let mut i = 0;
    while i < n {
        let c = w[i];
        if silent_e && i == n - 1 {
            break;
        }
        // Vowels written with two letters.
        let pairs = [("ee", "i"), ("ea", "i"), ("oo", "u"), ("ou", "W"), ("ai", "A"), ("ei", "A"), ("oi", "Y"), ("au", "ɔ"), ("aw", "ɔ"), ("oa", "O"), ("eu", "ju")];
        if let Some(&(s, p)) = pairs.iter().find(|(s, _)| starts(i, s)) {
            out.push(fixed(p));
            i += s.len();
            continue;
        }
        // ay, ey, oy and ow, unless a vowel follows (Maya, Rowan).
        let y_pairs = [("ay", "A", "A"), ("ey", "A", "i"), ("oy", "Y", "Y"), ("ow", "W", "O")];
        if let Some(&(s, mid, end)) = y_pairs.iter().find(|(s, _, _)| starts(i, s) && !vowel_after(i + 2)) {
            out.push(fixed(if i + 2 == n { end } else { mid }));
            i += s.len();
            continue;
        }
        if (starts(i, "ie") || starts(i, "ue")) && i + 2 == n {
            out.push(fixed(if c == 'i' { "i" } else { "u" }));
            i += 2;
            continue;
        }
        // y is a consonant at the start before a vowel, and between vowels (Priya); else a vowel.
        if c == 'y' && vowel_after(i + 1) && (i == 0 || is_plain_vowel(w[i - 1])) {
            out.push(Unit::Consonant("j", false));
            i += 1;
            continue;
        }
        if is_vowel(c) {
            let last = i + 1 == n;
            // A final e after a vowel is said (Zoe, Chloe).
            if c == 'e' && last && i > 0 && is_vowel(w[i - 1]) {
                out.push(fixed("i"));
                i += 1;
                continue;
            }
            let long = silent_e && i + 2 == n - 1;
            out.push(match c {
                'a' if last => fixed("ə"),
                'a' if long => fixed("A"),
                'a' => vowel("ɑ", "æ", "ɑɹ"),
                'e' if long => fixed("i"),
                'e' => vowel("i", "ɛ", "ɜɹ"),
                'i' if long => fixed("I"),
                'i' => vowel("i", "ɪ", "ɜɹ"),
                'o' if long => fixed("O"),
                'o' => vowel("O", "ɑ", "ɔɹ"),
                'u' if long => fixed("u"),
                'u' => vowel("u", "ʌ", "ɜɹ"),
                _ => vowel("i", "ɪ", "ɜɹ"),
            });
            i += 1;
            continue;
        }
        // Consonants written with more than one letter; those of two sounds close the syllable before them.
        let digraphs = [("tch", "ʧ", true), ("sch", "sk", true), ("th", "θ", false), ("sh", "ʃ", false), ("ch", "ʧ", false), ("ph", "f", false), ("wh", "w", false), ("ck", "k", true), ("dg", "ʤ", true), ("qu", "kw", true)];
        if let Some(&(s, p, closes)) = digraphs.iter().find(|(s, _, _)| starts(i, s)) {
            out.push(Unit::Consonant(p, closes));
            i += s.len();
            continue;
        }
        if i == 0 && (starts(0, "kn") || starts(0, "gn") || starts(0, "wr")) {
            out.push(Unit::Consonant(if c == 'w' { "ɹ" } else { "n" }, false));
            i = 2;
            continue;
        }
        if starts(i, "ng") && !vowel_after(i + 2) {
            out.push(Unit::Consonant("ŋ", false));
            i += 2;
            continue;
        }
        if starts(i, "gh") {
            if i == 0 {
                out.push(Unit::Consonant("ɡ", false));
            }
            i += 2;
            continue;
        }
        // A doubled consonant is said once, and closes the syllable before it (Hollis).
        if at(i + 1) == Some(c) {
            let p = single(c, at(i + 2));
            if !p.is_empty() {
                out.push(Unit::Consonant(p, true));
            }
            i += 2;
            continue;
        }
        // An h after a consonant, or with no vowel after it, is not said (Siobhan, Leah).
        if c == 'h' && i > 0 && (!vowel_after(i + 1) || !is_vowel(w[i - 1])) {
            i += 1;
            continue;
        }
        if c == 'x' {
            out.push(Unit::Consonant(if i == 0 { "z" } else { "ks" }, i != 0));
            i += 1;
            continue;
        }
        let p = single(c, at(i + 1));
        if !p.is_empty() {
            out.push(Unit::Consonant(p, false));
        }
        i += 1;
    }
    out
}

/// One consonant letter, by the letter after it.
fn single(c: char, next: Option<char>) -> &'static str {
    let soft = next.is_some_and(|n| matches!(n, 'e' | 'i' | 'y'));
    match c {
        'b' => "b",
        'c' if soft => "s",
        'c' => "k",
        'd' => "d",
        'f' => "f",
        'g' if soft => "ʤ",
        'g' => "ɡ",
        'h' => "h",
        'j' => "ʤ",
        'k' => "k",
        'l' => "l",
        'm' => "m",
        'n' => "n",
        'p' => "p",
        'q' => "k",
        'r' => "ɹ",
        's' => "s",
        't' => "t",
        'v' => "v",
        'w' => "w",
        'z' => "z",
        _ => "",
    }
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
        for w in ["OpenStage", "QDA", "lessonplanner", "zxqv", "Priya", "F6", "INT-01", "Shift+F6", "cmi5", "H.264"] {
            let said = f.say(w);
            assert!(!said.is_empty() && !said.contains('❓'), "{w}: {said}");
        }
        assert_eq!(f.say("QDA"), "kjˈu dˈi ˈA");
    }

    #[test]
    fn names_are_sounded_out_not_spelled() {
        // The pronunciations the courses had to be given by hand, now what the voice says on its own.
        assert_eq!(sound_out("Priya").as_deref(), Some("pɹˈijə"));
        assert_eq!(sound_out("Theo").as_deref(), Some("θˈiO"));
        assert_eq!(sound_out("Akafer").as_deref(), Some("ˈɑkəfəɹ"));
        assert_eq!(sound_out("Kokoro").as_deref(), Some("kOkˈOɹO"));
        assert_eq!(sound_out("Hollis").as_deref(), Some("hˈɑlɪs"));
        assert_eq!(sound_out("Mei").as_deref(), Some("mˈA"));
        assert_eq!(sound_out("Delgado").as_deref(), Some("dəlɡˈɑdO"));
        assert_eq!(sound_out("Samira").as_deref(), Some("səmˈiɹə"));
        assert_eq!(sound_out("Zoe").as_deref(), Some("zˈOi"));
        assert_eq!(sound_out("Maya").as_deref(), Some("mˈɑjə"));
        assert_eq!(sound_out("vivo").as_deref(), Some("vˈivO"));
    }

    #[test]
    fn initials_and_unsayable_words_are_left_to_be_spelled() {
        for w in ["SCORM", "WCAG", "cmi", "img", "fr", "zxqv", "xAPI"] {
            assert_eq!(sound_out(w), None, "{w}");
        }
        let f = WordFallback::new();
        assert_eq!(f.say("zxqv"), "zˈi ˈɛks kjˈu vˈi");
    }

    #[test]
    fn digits_written_after_letters_are_said() {
        let f = WordFallback::new();
        let k = |w: &str| f.known(w).unwrap();
        assert_eq!(f.say("F6"), format!("ˈɛf {}", f.digits("6", false)));
        assert_eq!(f.say("F10"), format!("ˈɛf {}", f.digits("10", false)));
        assert_eq!(f.say("P07"), format!("pˈi {} {}", k("zero"), k("seven")));
        assert!(f.say("INT-01").ends_with(&format!("{} {}", k("zero"), k("one"))), "{}", f.say("INT-01"));
        assert!(f.say("H.264").ends_with(&format!("{} {} {}", k("two"), k("six"), k("four"))), "{}", f.say("H.264"));
        let shift = f.say("Shift+F6");
        assert!(shift.contains(&k("plus")) && shift.ends_with(&format!("ˈɛf {}", f.digits("6", false))), "{shift}");
        assert!(f.say("cmi5").starts_with("sˈi ˈɛm ˈI "), "{}", f.say("cmi5"));
        assert_eq!(f.say("Ctrl"), k("control"));
        // A number said as a number, not as its digits' names.
        assert!(!f.digits("10", false).contains(&k("one")));
    }

    #[test]
    fn a_known_word_with_an_ending_is_not_split_in_two() {
        let f = WordFallback::new();
        assert_eq!(f.say("copied"), format!("{}d", f.known("copy").unwrap()));
    }

    #[test]
    fn decimals_keep_every_digit() {
        assert_eq!(say_decimals("It costs 51.50 now."), format!("It costs 51 {POINT} five zero now."));
        assert_eq!(say_decimals("version 2.0"), format!("version 2 {POINT} zero"));
        assert_eq!(say_decimals("1,234.50 units"), format!("1,234 {POINT} five zero units"));
        assert_eq!(say_decimals("0.800 of them"), format!("0 {POINT} eight zero zero of them"));
        assert_eq!(say_decimals("WCAG 1.1's rule"), format!("WCAG 1 {POINT} one's rule"));
        // Left alone: decimals the dictionary says right, money, versions with more points, codes, and whole numbers.
        for t in ["about 3.05 seconds", "It ends at 4.5.", "It costs $51.50 now.", "WCAG 1.1.1 level A", "H.264", "v1.2", "1.5x", "SCORM 2004", "12, 13 and 14."] {
            assert_eq!(say_decimals(t), t);
        }
    }

    #[test]
    fn a_digit_with_an_s_and_joined_words_ending_in_a_short_word() {
        let f = WordFallback::new();
        assert_eq!(f.say("1's"), format!("{}z", f.digits("1", false)));
        assert_eq!(f.say("plugin"), format!("{} {}", f.known("plug").unwrap(), f.known("in").unwrap()));
    }

    #[test]
    fn the_voice_goes_to_the_card_only_while_the_computer_is_busy() {
        assert_eq!(cards_to_try("", || Some(0.03)), &[] as &[Device], "quiet: the processor");
        assert_eq!(cards_to_try("auto", || Some(0.40)), &[Device::Cuda, Device::DirectMl], "busy: CUDA, else DirectML");
        assert_eq!(cards_to_try("", || None), &[] as &[Device], "not known: the processor");
        assert_eq!(cards_to_try("processor", || panic!("not asked")), &[] as &[Device]);
        assert_eq!(cards_to_try("directml", || panic!("not asked")), &[Device::DirectMl]);
        assert_eq!(cards_to_try("graphics-card", || panic!("not asked")), &[Device::Cuda, Device::DirectMl]);
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
