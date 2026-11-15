# Handoff

Last updated 2026-11-15, at the end of the phase 2 build session.

## Where things are

Phases 1 and 2 are built, and their acceptance tests pass on Jason's computer (Windows 11 build 26200, two 1920 by 1080
displays at 100 percent; takes run on the second display).

Phase 1, "One video by hand":

- `examples/plan-a-lesson.json` (23 steps) makes a 109.5 second video with the Kokoro voice (120.0 seconds with the
  Windows voice), 1920 by 1080, 30 frames a second, H.264 with AAC sound, with captions (SRT and VTT), a transcript and a
  chapter list.
- `Check Same Video.bat` makes it twice from scratch and compares the take's pictures, the timeline, every frame and
  sound sample given to the encoder, and the two finished MP4 files read back with Windows' decoder. Last run 2026-11-15,
  after the phase 2 changes: 3,284 of 3,284 frames identical to the pixel, the sound identical, and the same frame
  fingerprint as before phase 2 (the guard does not change the video). Author's first look also passes (see below).
- Jason watched and listened to both videos on 2026-11-14: everything works, the narration included.

Phase 2, "Guard and package" (`docs/guard.md`):

- `Check Guard.bat` passes (2026-11-15): `examples/guard/blocked-name.json` is stopped at the script scan with nothing
  recorded; the planted path in `examples/guard/planted-path.json` is flagged by the frame scan (read from the picture and
  reported by the program), with nothing else flagged; export stays shut while the flag is open, and an export tried
  anyway makes nothing.
- Also tried by hand: a blur chosen in review goes into the script, the remade video and its thumbnail have the box, and
  the flag then counts as resolved; approving and exporting in the review screen makes the package and checklist.
- The review screen was checked in a browser with a stand-in for the app's file access
  (`tools/review-harness/`, development only), and the real app opens a review on the second display.
- 79 TypeScript tests and 19 helper tests pass (`Test Everything.bat`). The licence check passes; phase 2 added no
  packages (text recognition is part of Windows).

## How a video is made

1. The script is checked (`src/script/validate.ts`); a version 1 script is read as version 2 (`src/script/migrate.ts`).
2. The script scan checks every word a viewer will see or hear against the blocklist (`src/guard/script-scan.ts`). A hit
   stops here, before anything is recorded.
3. Narration: one clip per line with Kokoro (or a Windows voice) in `studio-helper speak`. A clip's file name comes from
   the voice and the words as spoken, so changing one line makes one new clip.
4. The take: the program starts full screen in demo mode on the chosen display; `studio-helper take` watches its window
   with OpenScreen's capture engine; the player (`src/pipeline/player.ts`) performs each step through the hook and saves a
   still picture after every change, once the window has stopped changing. At each picture it also asks the hook for the
   text on screen (hook version 2), for the frame scan.
5. The timeline (`src/timeline/build.ts`) places every picture, pointer move, click, callout and clip on a frame, from
   the narration's length and fixed paces. Nothing reads a clock, which is why two runs give the same video.
6. Captions, transcript and chapters are written from the script and the timeline.
7. `studio-helper assemble` draws every frame (cards, pictures, blurred boxes, callouts, click circle, pointer) with the
   engine's canvas and Windows' text, mixes the narration, and writes the MP4 with Windows' own encoders.
8. The frame scan: `studio-helper ocr` reads every picture with Windows' text recognition; the flags go to `review.json`
   and `guard-report.txt`. Decisions from an earlier run with the same pictures carry over; approval never does.
9. The thumbnail (`studio-helper thumbnail`) and the publishing details as they stand now (`publish.json`).
10. A person reviews and approves in the app (`Review Video.bat`), then exports (`Export Packages.bat` or the app).

## Decisions

Confirmed by Jason:

1. **Default voice: Kokoro-82M, run natively in the helper** (2026-11-14). Downloaded once with `Get Voice.bat`
   (340 MB, every file checked), then offline. Voice `af_heart` by default; the Windows voices remain as a second engine.
   Details and the licence audit: `docs/voice-models.md`.
2. **First product: OpenStage Author** (2026-11-14).
3. **Still pictures, not a live recording** (2026-11-14). The take saves a still picture after each change, and the
   video's timing comes from the narration. A program's own animations are not shown; changes appear as cuts.
4. **No product names in the copied engine either** (2026-11-14). Both copies are reworded alike.
5. **Licences** (2026-11-14): MPL-2.0 for code used unchanged and the WTFPL are accepted; the list is in
   `tools/licence-rules.mjs` and CLAUDE.md.
6. **The blocklist's names stay out of the repository** (2026-11-15). The repository ships categories and patterns; each
   person's names go in `blocklist.local.json`, which git ignores (`Edit Blocklist.bat`).
7. **The frame scan reads the pictures and the page** (2026-11-15): Windows' text recognition, plus the exact text the
   program's hook reports.
8. **No separate recording account is required** (2026-11-15): the demo workspace, plus checks for this computer's user
   name, home folder and computer name. A recording-only account stays optional.
9. **The "computer generated" line in descriptions is off by default** (2026-11-15). Every package's upload.txt says how
   the narration was made either way, and a project can switch the line on (`publish.disclosureLine`).

Made by Claude, open to change:

1. **The text caret is hidden in demo mode** (so a blinking caret cannot make two takes differ).
2. **The encoder is Windows' own** (H.264 and AAC). No FFmpeg, nothing to licence.
3. **Where the player runs.** A Node script behind `Make Video.bat`. Moving it into the app window is the next step for
   the app itself.
4. **Project file.** Scripts are separate JSON files with a shared `studio-project.json`.
5. **Paces.** Pointer travel 450 to 1300 ms, 65 ms a typed character, 0.45 s between steps, title card at least 3 s,
   end card at least 4 s. All adjustable in `studio-project.json`.
6. **The review gate lives in the app window**, keyboard and screen reader operable, every state in words and symbols.
   Decisions need a person's name, which the window remembers on this computer.
7. **A blur is a box in the script** (`redactions`, format version 2), so it survives every rerun and the script still
   fully describes the video. It counts as resolved only once the remade video has it. The review screen adds it without
   reformatting the rest of the script.
8. **Matching tolerance.** Names of up to five letters must match exactly (one letter off would catch ordinary words:
   "json" for a user name "Jason"); six to nine letters allow one wrong, longer names two. Look-alike letters are merged
   first. Only words a viewer sees or hears are scanned, not notes for people.
9. **A video must be approved by a person even with no flags.** CLAUDE.md says a person approves each video before it
   leaves the machine; the gate applies that to every video.
10. **Publishing details are taken when the video is made** (`publish.json`), so editing the script later cannot change
    what goes with a video that was already reviewed.
11. **The thumbnail template**: the product's name and the title on the left, a close view of one step on the right
    (the last step, or `publish.thumbnailStep`), colours from `studio-project.json` with a contrast warning.
12. **The repeat check skips the frame scan**, which does not change the video, to save time.

## Next

- OpenStage Author: the hook is on Author's branch `studio-demo-hook` (pushed, not merged). The hook copy there has the
  phase 2 `text` command, uncommitted until Jason says yes. Still to do: name the buttons in its panes and dialogs, and
  write the Author tutorial scripts and their demo courses.
- Put the player in the app window: open a script, make the video, show progress, play the result, go to review.
- Phase 3: manual import, planner, scriptwriter, rehearsal with repair, metadata writer.

## Things to know

- **Takes do not depend on the computer's state.** In demo mode the hook rewrites the page's own focus and hover rules to
  follow markers it sets, keeps track of the keyboard focus itself, draws drop-down lists itself, and gives them their own
  layer; the take waits five seconds for a program to finish starting. If a repeat check ever fails, the take log shows
  the first picture that differs.
- `local-settings.json` (git ignores it) holds settings for this computer only: `{ "monitor": 2 }` puts takes on the second
  display, which is how Jason's computer is set up. Every double-click script follows it; `--monitor <n>` overrides it.
  The app's own window also takes `--monitor <n>` (used for tests).
- The practice program lays its page out at 1280 by 720 CSS pixels and is shown at 1920 by 1080, so text reads well at
  1080p whatever the display's own scale. `--layout-width` changes it.
- Text recognition needs Windows' English text recognition, which comes with English Windows. The helper says plainly
  if it is missing.
- Rendered output, narration clips and packages go in `renders/`, `work/` and `packages/`, which git ignores.
