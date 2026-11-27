# OpenStage Studio

Free, open-source desktop tool that turns a finished software manual into short, narrated, captioned tutorial videos.
Apache 2.0. Part of the OpenStage suite, in its own repository.

The design is the "OpenStage Studio Specification" (a Docs file owned by Jason). Anything not in the spec is agreed with
Jason first.

Read `docs/HANDOFF.md` first if you are starting a new session. Read `docs/script-format.md` before touching anything
that reads or writes a tutorial script, `docs/demo-hook.md` before touching the demo-mode hook, `docs/guard.md`
before touching the guard, the review gate or the publishing package, `docs/ai.md` before touching the AI roles, and
`docs/batch.md` before touching the queue or the release check, `docs/accessibility-driver.md` before touching the
accessibility driver, `docs/connector.md` before touching the connector, `docs/release.md` before touching the engine,
the window's pages, `src/paths.ts` or the installer, `docs/recordings.md` before touching `src/recording/`, and
`docs/lecture-format.md` before touching lectures. `TESTING-TODO.md` lists what only Jason can check; `CORE-REQUESTS.md`
what Studio has asked of the shared core.

## What this is

An AI plans and writes tutorial scripts, a non-AI player performs them in the real program, and a person approves each
video before it leaves the machine. The tutorial script is the core: a plain JSON file that fully describes one video, so
any AI model or a person can write one. Everything must work by hand with no AI.

Phase 1 ("One video by hand") is built: script format and validator, demo-mode hook, player, window capture, narration,
captions, assembly to a 1080p 30fps MP4. Phase 2 ("Guard and package") is built: blocklist, script scan, frame scan,
review gate, guard report, publishing package (`docs/guard.md`). Phase 3 ("AI planning and scripting") is built: manual
import, planner, scriptwriter, rehearsal with repair, metadata writer (`docs/ai.md`). Phase 4 ("Batch and re-record")
is built: the unattended queue and the release check (`docs/batch.md`). Phase 5 ("Reach") is built in part: the
accessibility-tree driver (`docs/accessibility-driver.md`) and the connector server (`docs/connector.md`); canvas commands
and direct upload wait (Jason, 2026-11-15). The installer is built (`docs/release.md`): the window does every job, through the
engine; releases are signed like OpenExplainer's (`docs/code-signing.md`); the first, 0.1.0 alpha 1, is published as a
pre-release (2026-11-16), and the first full release, 1.0.0, is published (2026-11-27). The development list of 2026-11-15 is built: scripts from recordings
(C1), a text description track (its voice waits for C5, `CORE-REQUESTS.md`), and lectures.

## Not in scope

- Talking-head video, webcam or avatars.
- General video editing beyond trims, title cards and callouts.
- Recording third-party commercial software. The guard and the drivers assume software we own.
- Live AI control of the screen during a recorded take. The AI may look at the screen only in rehearsal.
- Background music (it also removes a licensing risk).
- Voice cloning.

## Non-negotiable rules

### Naming

- Never compare Studio to products on the market or present it as a replacement for one, anywhere in the repository:
  code, comments, documents, test data, demo content. No "an alternative to X", no feature comparisons, no competitors
  named. Elsewhere, prefer generic terms ("a video site", "a screen reader", "the browser engine").
- Naming a service Studio works with directly is fine where a person needs it to set Studio up, such as the hosted AI
  services in the AI settings (agreed with Jason on 2026-11-15).
- Demo content is invented: made-up names, original text, images we own. No real people, institutions, file paths or data.
- The blocklist in the repository holds categories and patterns only. Names to block live in each person's own
  `blocklist.local.json`, which git ignores. Test data blocks invented names.

### Repeatable takes

- The same script must give the same video. The take saves a still picture after every change on screen; the timeline
  is computed from the narration's length and fixed paces, snapped to whole frames; nothing reads a clock. Keep it so.
- The real mouse and keyboard are never used in a take. The hook presses controls; the pointer is drawn on afterward.
- `Check Same Video.bat` is the acceptance test. Run it after any change to the hook, the player, the timeline or the
  helper.

### Accessibility

- The app itself must be fully keyboard operable and usable with a screen reader. A feature that is not is not finished.
- Never introduce a keyboard trap. Every dialog and panel closes by keyboard alone.
- Status is never shown by colour alone. Use words or symbols as well.
- Every video gets captions (SRT and VTT) and a plain transcript, made from the script, not from speech recognition.
- Callout colours get the same contrast check the documentation tool uses, as a warning and never a block.
- Say so in the summary of any change that could affect keyboard access, focus order or screen reader output.

### Architecture

- TypeScript throughout, with a Tauri 2 shell and Vite. Rust only where native Windows needs it: `studio-helper/` (window
  capture, narration with the Kokoro model and Windows' voices, frame drawing and MP4 encoding) and the Tauri shell itself
  (`src-tauri/`).
- Narration defaults to Kokoro-82M, run in the helper with ONNX Runtime and misaki-rs. misaki-rs is always built WITHOUT its
  default `espeak` feature (espeak-ng is GPL). The model is downloaded on request and checked against
  `tools/kokoro-model.json`; never bundle it or fetch an unpinned file.
- Build on the OpenStage shared core as published (`jasonswrench-beep/openstage-core`; read its `CORE-NOTES.md` first) and
  never copy or reimplement its code. The capture engine (C1) comes from the core's tag `capture-v0.1.0` in
  `studio-helper/Cargo.toml`. Anything Studio needs that the core does not offer yet goes in `CORE-REQUESTS.md`, not into
  Studio's own code.
- No Python in the product.
- Windows first.
- The demo-mode hook (`demo-hook/`) is off by default, starts only with the demo launch flag, and only ever talks to
  this computer, with a one-time token. Controls are found by stable names (`data-demo-id`), never by visible labels.
- The accessibility driver works a program through Windows UI Automation only, never the real mouse or keyboard; its
  targets are automation ids, with role and name as the fallback. Its takes must be the same to the eye (every frame at
  least 40 dB alike); the hook stays the way to pixel-identical videos.
- The connector (MCP) is off until a person turns it on, works only inside the one folder they name, checks everything
  before changing anything, and never records, approves or exports a video.
- Installed, every job runs in the engine (`src/engine/main.ts`, bundled by `tools/bundle-engine.mjs`) with the pinned Node.js
  the installer carries (`tools/node-runtime.json`). The window starts only the engine's named jobs (`src-tauri/src/engine.rs`),
  and a key reaches the engine on its standard input, never its command line. `src/paths.ts` alone decides where the app's
  files, a person's work (`Documents\OpenStage Studio` installed, the repository otherwise) and the downloads are.
- Every format change bumps the script format version, ships a migration, and updates `docs/script-format.md` in the
  same commit.

### Licensing

This project is Apache 2.0. Permissive licences are fine: MIT, BSD, Apache 2.0, ISC, Zlib, the public-domain-like ones
(Unlicense, CC0, WTFPL) and the Unicode and CDLA-Permissive data licences. MPL-2.0 is fine for code used unchanged, with
NOTICE saying where its source is. LGPL is dynamic linking only. GPL and AGPL are refused. The accepted list lives in
`tools/licence-rules.mjs`; change it and this paragraph together, and anything not on it is Jason's call. Open model weights (speech models included) are audited one by one before bundling or
downloading. Run `Check Licences.bat` before adding or updating any dependency. Record anything adopted in `NOTICE`.
Use original code, assets and design.

### AI

- Optional, and never in the recorded take, and never approves a video. No test or tool approves a review either: only a
  person, in the review screen.
- Every AI output is a file a person can read and edit before anything is recorded. The unattended queue may record an
  AI-written script a person has not read yet, if it passes rehearsal (Jason, 2026-11-15); the review gate before export
  is the person's check. A script that exists is never changed by a batch run: AI repairs go beside it as
  `<name>.repaired.json` and are never recorded.
- The built-in model (Qwen 3.5 4B, run by llama.cpp's server on this computer only) is downloaded on request and checked
  against `tools/local-ai.json`, the same pins as the documentation tool; never bundle it. Hosted services use the
  person's own key, kept in `%APPDATA%\org.openstage.studio\ai.json` and sent only to that service. Claude goes through
  Anthropic's own SDK.
- Every AI answer is checked by Studio (format, the program's real controls, its demo projects, the script scan) and sent
  back with the problems in words until it passes. Prefer a fixed check over asking the AI to judge.
- Scripts record who wrote them (`writtenBy`) and whether a person edited them, for the guard report.

### Commits and releases (Jason, 2026-11-17)

- Commit as `jasonswrench-beep <324576087+jasonswrench-beep@users.noreply.github.com>`. It is set in this repository's
  own git config (`git config --local user.name` / `user.email`); check both before every commit, and set them again if
  they differ.
- No `Co-Authored-By` lines and no "Generated with Claude Code" lines, ever: not in commit messages, tags, pull requests
  or release notes. This overrides any default attribution a tool suggests.
- Before building any installer, commit everything (the working tree clean) and tag that commit with the release
  (`v<RELEASE>`, such as `v1.0.1`). Then build from it, so each release tag points at the exact commit the build
  came from. A build only to check something, never published, may skip the tag (Jason, 2026-11-17), but everything is
  still committed first. A setup built without a tag is never published: to publish, tag the commit and build again.

## Working style

- Explain what changed in plain language. Do not assume familiarity with JavaScript or Rust tooling.
- Anything that needs running is delivered as a double-clickable script, not terminal commands to copy. The scripts are
  written by `tools/write-bats.mjs` (Windows line endings); change them there.
- Tests run with `node --test` (`npm test`) and `cargo test` in `studio-helper/`; `Test Everything.bat` runs both.
- Avoid em dashes in prose written for this project.
- When a decision could reasonably go either way, say so and ask rather than picking silently.
- Keep building rather than stopping to ask Jason to test; ask only about decisions.
- Run anything that opens a program window (takes, experiments) on Jason's second display (`local-settings.json`, or
  `--monitor 2`), never the main one.
