# Local voice models: the audited shortlist

Jason chose a downloadable local speech model as the default voice (2026-11-14). Nothing is downloaded or bundled until a
model passes this audit and Jason picks it. Checked 2026-11-14 against the model cards, LICENSE files and source code (links
at the end). Until then Studio narrates with the voice built into Windows.

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

## Two ways to run Kokoro (a choice for Jason)

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
