# OpenStage Studio

Free, open-source desktop tool that turns a finished software manual into short, narrated, captioned tutorial videos.
Apache 2.0. Part of the OpenStage suite, in its own repository.

The design is the "OpenStage Studio Specification" (a Docs file owned by Jason). Anything not in the spec is agreed with
Jason first.

Read `docs/HANDOFF.md` first if you are starting a new session. Read `docs/script-format.md` before touching anything
that reads or writes a tutorial script, and `docs/demo-hook.md` before touching the demo-mode hook.

## What this is

An AI plans and writes tutorial scripts, a non-AI player performs them in the real program, and a person approves each
video before it leaves the machine. The tutorial script is the core: a plain JSON file that fully describes one video, so
any AI model or a person can write one. Everything must work by hand with no AI.

Phase 1 ("One video by hand") is built: script format and validator, demo-mode hook, player, window capture, narration,
captions, assembly to a 1080p 30fps MP4. Phases 2 to 5 (guard and package, AI planning, batch, reach) are in the spec.

## Not in scope

- Talking-head video, webcam or avatars.
- General video editing beyond trims, title cards and callouts.
- Recording third-party commercial software. The guard and the drivers assume software we own.
- Live AI control of the screen during a recorded take. The AI may look at the screen only in rehearsal.
- Background music (it also removes a licensing risk).
- Voice cloning.

## Non-negotiable rules

### Naming

- Never name commercial software, or compare Studio to products on the market, anywhere in the repository: code,
  comments, documents, test data, demo content. Use generic terms ("a video site", "a screen reader", "the browser engine").
- Demo content is invented: made-up names, original text, images we own. No real people, institutions, file paths or data.

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
  capture, Windows' speech, frame drawing and MP4 encoding) and the Tauri shell itself (`src-tauri/`).
- The capture engine in `capture/` is OpenScreen's, copied from OpenStage Author (`capture/IMPORT-MANIFEST.md`). Its code is
  unchanged; only product names in comments and messages were reworded, in both repositories. Change it only when Studio
  needs it, say so, record the change in the manifest, and make the same change in Author's copy so the two stay identical.
- No Python in the product.
- Windows first.
- The demo-mode hook (`demo-hook/`) is off by default, starts only with the demo launch flag, and only ever talks to
  this computer, with a one-time token. Controls are found by stable names (`data-demo-id`), never by visible labels.
- Every format change bumps the script format version, ships a migration, and updates `docs/script-format.md` in the
  same commit.

### Licensing

This project is Apache 2.0. Permissive licences (MIT, BSD, Apache 2.0, ISC, Zlib) are fine. LGPL is dynamic linking
only. GPL and AGPL are refused. Open model weights (speech models included) are audited one by one before bundling or
downloading. Run `Check Licences.bat` before adding or updating any dependency. Record anything adopted in `NOTICE`.
Use original code, assets and design.

### AI

- Optional, and never in the recorded take, and never approves a video.
- Every AI output is a file a person can read and edit before anything is recorded.
- Scripts record who wrote them (`writtenBy`) and whether a person edited them, for the guard report.

## Working style

- Explain what changed in plain language. Do not assume familiarity with JavaScript or Rust tooling.
- Anything that needs running is delivered as a double-clickable script, not terminal commands to copy. The scripts are
  written by `tools/write-bats.mjs` (Windows line endings); change them there.
- Tests run with `node --test` (`npm test`) and `cargo test` in `studio-helper/`; `Test Everything.bat` runs both.
- Avoid em dashes in prose written for this project.
- When a decision could reasonably go either way, say so and ask rather than picking silently.
- Keep building rather than stopping to ask Jason to test; ask only about decisions.
