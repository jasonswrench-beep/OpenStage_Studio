# Local voice models: the audited shortlist

Jason chose a downloadable local speech model as the default voice, and then Kokoro-82M run natively inside Studio's helper
(both 2026-11-14). That is built: see "What was built" at the end. The audit below was checked on 2026-11-14 against the model
cards, LICENSE files and source code (links further down).

What a model must have: weights that may be passed on and used commercially with no non-commercial clause; runtime code
that is permissive; a text front end (the part that turns spelling into sounds) that is not GPL, or a permissive
replacement; a way to run it on Windows without Python; and the same sound for the same text every time.

## The candidates

| Model | Size | Sound | English voices | Weights | Front end | Runs natively | Same every time | Verdict |
|---|---|---|---|---|---|---|---|---|
| Kokoro-82M 1.0 | 92 to 326 MB | 24 kHz | 28 (US and UK) | Apache-2.0 | misaki, Apache-2.0; its GPL fallback can be switched off; Rust ports are MIT | Yes (ONNX) | With a fixed seed, to be proven | Passes, with conditions |
| Supertonic 3 (or 2) | about 400 MB | 44.1 kHz | 10 | OpenRAIL-M, with use rules | None needed (reads letters directly) | Yes (official Rust example) | After seeding its noise | Passes, with conditions |
| MeloTTS English | not stated | not checked | 5 accents | MIT | Permissive, but needs a large language model and Python | No | With a fixed seed | Fallback only |
| Kitten TTS 0.8 | 25 to 80 MB | 24 kHz | 8 | Apache-2.0 | Needs espeak-ng (GPL) as shipped | Yes (ONNX) | Not documented | Fails as shipped |
| Kitten TTS 2 | 8 to 954 MB | 24 kHz | 115 | Community licence that ends above a revenue level | Needs espeak-ng (GPL) | Yes | Not documented | Fails |
| Piper voices | about 60 MB a voice | varies | many | Varies; the best known English voice is research only | Built in espeak-ng; the engine is GPL-3 | Yes | Noise in the model | Fails |
| Matcha-TTS | not stated | not stated | 1 | Not stated | Needs espeak-ng | Yes | With a fixed seed | Fails |

## Recommendation

1. **Kokoro-82M.** The best English narration of the group, many US and UK voices, Apache-2.0 weights. It is also the voice
   OpenStage Author already narrates with, so the suite would sound the same. Conditions: use its dictionary front end with
   the GPL fallback switched off, add a permissive way to say words missing from the dictionary (letter-to-sound rules or
   spelling them out), and prove that two runs give identical sound (seed the model's noise, or make it a fixed input).
2. **Supertonic.** No front end to license and official Rust code. Conditions: its licence's use rules must be passed on to
   users, including that machine-made content is disclosed (Studio already records how each video was narrated, so the
   disclosure line is available); its noise must be seeded for repeatable sound; its repository is archived, so it gets
   no more updates.

## Two ways to run Kokoro (Jason chose A)

- **A. Natively in Studio's helper** (recommended): the ONNX model run by a permissive runtime inside `studio-helper`, with a
  permissive Rust front end. No Python and no GPL anywhere. More work, and the front end's handling of unknown words needs
  testing on real manuals.
- **B. Reuse Author's narration voice**: run the Kokoro engine that OpenStage Author installs on request (a separate program,
  with its GPL parts installed by the person, as `docs/narration-setup.md` in Author explains). Quickest, and one voice for
  the whole suite, but it needs Author's install, brings Python back as a separate program, and its sound has not been
  checked for exact repeats.

## Pages opened

- https://huggingface.co/hexgrad/Kokoro-82M
- https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
- https://raw.githubusercontent.com/hexgrad/kokoro/main/kokoro/istftnet.py
- https://github.com/hexgrad/misaki
- https://lib.rs/crates/misaki-rs
- https://docs.rs/crate/voice-g2p/latest/source/README.md
- https://huggingface.co/Supertone/supertonic-2
- https://huggingface.co/Supertone/supertonic-3 (and its LICENSE, onnx and voice_styles folders)
- https://github.com/supertone-inc/supertonic (and rust/src/helper.rs)
- https://github.com/KittenML/KittenTTS (and pyproject.toml)
- https://huggingface.co/KittenML/kitten-tts-mini-0.8
- https://huggingface.co/KittenML/kitten-tts-2
- https://github.com/OHF-Voice/piper1-gpl (and docs/LICENSING.md)
- https://github.com/myshell-ai/MeloTTS (and melo/text/english.py), https://huggingface.co/myshell-ai/MeloTTS-English
- https://github.com/shivammehta25/Matcha-TTS (and matcha/text/cleaners.py)

Not yet checked: MeloTTS's sound rate and size, Matcha's weights licence, Piper's voice sizes, whether the Kokoro and
Kitten ONNX files contain unseeded random steps, and whether the Rust front end builds on Windows.

## What was built (2026-11-14)

- `studio-helper/src/kokoro.rs` runs the ONNX model with ONNX Runtime (linked in, one thread; on the graphics card since
  2026-11-26, below) and turns
  words into sounds with misaki-rs built without its GPL fallback. Words its dictionary does not know go through Studio's
  own fallback: joined words are split where the case changes (OpenStage), two known words written as one are found, common
  endings are taken off, and anything left is spelled out letter by letter. Studio's pronunciation list comes first.
- `tools/kokoro-model.json` pins the model's revision and every file's size and SHA-256 (the model, its vocabulary and the 28
  English voices: 340 MB). `Get Voice.bat` downloads them into `%LOCALAPPDATA%\org.openstage.studio\voices\` (until 2026-11-15 `...\OpenStage Studio\voices\`, moved across by itself), with
  progress, carrying on after an interruption, and stopping on Ctrl+C; a file that does not match is refused.
- The default voice is `af_heart` (US English); any of the 28 can be named in `studio-project.json`.
- The same text gives the same sound every time: checked byte for byte, and in the acceptance test (two full runs from
  scratch, identical sound).
- `studio-helper phonemes --text "..."` shows how a line will be said, to check a pronunciation.
- Licences: ONNX Runtime includes Eigen, under the Mozilla Public License 2.0 (file-level copyleft, not GPL), and misaki-rs
  uses language-tokenizer, under the WTFPL. Both were accepted on 2026-11-14: Eigen is used unchanged and NOTICE says where
  its source is; the WTFPL has no conditions.

## The graphics card and the front end (2026-11-26)

- Where the model runs (`OPENSTAGE_VOICE_DEVICE`, read by the helper): by default on the processor while the computer is
  quiet, and on the graphics card through CUDA while other work uses a tenth of the processor or more (Jason, 2026-11-26:
  "if there is any other work happening, go to the graphics card. It just sucks up too much of the CPU"). `processor`,
  `cuda`, `directml` and `graphics-card` (CUDA, else DirectML) choose one. A card must take the model and say a test word;
  if it does not, or fails part way, the voice is on the processor and the helper says why in a note. The `voice` event
  names the device. `Check Same Video.bat` keeps both of its runs on the processor unless told otherwise.
- CUDA needs NVIDIA's CUDA 13 runtime (cudart, cuBLAS, cuFFT) and cuDNN 9, which are under NVIDIA's own licences and are not
  part of Studio or its installer: the helper looks for them in `OPENSTAGE_CUDA_DIR`, else
  `%LOCALAPPDATA%\openstage-cuda-trial\bin`, else Windows' usual places. With ort's `cuda` and `copy-dylibs` features the
  build downloads ONNX Runtime's CUDA build (89 MB, from the same place as before; it carries DirectML too) and puts
  `onnxruntime_providers_cuda.dll` and `onnxruntime_providers_shared.dll` beside the helper. Without them, or without NVIDIA's
  files, CUDA is simply not taken. Whether the installer may carry these, or point to NVIDIA's, is Jason's licence decision.
- Measured on 2026-11-26 (RTX 3050, eight course lines, against the processor): CUDA, with full 32-bit sums (TF32 off) and
  deterministic kernels, gives every line the same length to the sample, the same loudness (within 0.01 dB), the same pitch
  (median difference 0 cents) and a spectrum within 0.06 dB in every band (log-spectral distance about 0.5 dB, where the
  same recording shifted by 11 ms is about 3 dB): by every measure here the same voice, though not the same to the sample
  (Jason's ears are the last check, TESTING-TODO.md). It is 4 to 10 times as
  fast, and the same every run. DirectML on the same card is about 3 times as fast and the same every run, but its timbre is
  not the processor's: 3.5 to 5 dB less between 1 and 4 kHz, about 2 dB more above 4 kHz and 1.5 dB quieter, whatever its
  settings (graph optimisation, fusion, device). So it is never chosen by itself.
- The fallback no longer spells out what it does not know. Letters and digits written together are said piece by piece
  (F6 "F six", F10 "F ten", P07 and INT-01 "zero seven" and "zero one", H.264 "H two six four", Shift+F6 "Shift plus F
  six"); a known word with an ending comes before splitting (copied is copy with -ed, not "co pied"); and a name is sounded
  out from its spelling (Priya, Delgado, Theo, Mei, Kokoro), stressed on the first syllable or, in a word of three or more
  that ends in a vowel, the last but one. Only initials (capitals) and what cannot be said as one word are spelled.
- A number with a decimal point keeps every digit: "51.50" is "fifty one point five zero", "2.0" "two point zero" and
  "1.1's" "one point one's" (the dictionary alone said "fifty one point five", "two" and only "s"). Other decimals, money and
  numbers with more than one point are left to the dictionary, which says them right; "1's" is "ones" (it was "s").
- A clip's key carries the front end's version (`KOKORO_WORDS` in `src/narration/narration.ts`), so clips made before a
  change are made again. Raise it with any change that says a word another way.
