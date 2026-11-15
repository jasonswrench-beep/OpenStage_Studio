# Handoff

Last updated 2026-11-14, at the end of the first build session.

## Where things are

Phase 1 ("One video by hand") is built and its acceptance test passes on Jason's computer (Windows 11 build 26200, two
1920 by 1080 displays at 100 percent):

- `examples/plan-a-lesson.json` (23 steps) makes a 120.0 second video, 1920 by 1080, 30 frames a second, H.264 with AAC
  sound, with captions (SRT and VTT), a transcript and a chapter list.
- `Check Same Video.bat` made it twice from scratch (new narration clips, a new take each time). The take's pictures, the
  timeline, every frame and sound sample given to the encoder, and the two finished MP4 files read back with Windows'
  decoder were all the same: 3,601 of 3,601 frames identical to the pixel, the sound identical.
- 41 TypeScript tests and 14 helper tests pass (`Test Everything.bat`). The licence check passes.

Nothing has been watched or listened to by a person yet. Frames were looked at as still pictures; the sound was measured
but not heard.

## How a video is made

1. The script is checked (`src/script/validate.ts`).
2. Narration: one clip per line with Windows' built-in voice (`studio-helper speak`). A clip's file name comes from
   the voice and the words as spoken, so changing one line makes one new clip.
3. The take: Studio's app starts the practice program full screen in demo mode; `studio-helper take` watches its window
   with OpenScreen's capture engine; the player (`src/pipeline/player.ts`) performs each step through the hook and saves a
   still picture after every change, once the window has stopped changing.
4. The timeline (`src/timeline/build.ts`) places every picture, pointer move, click, callout and clip on a frame, from
   the narration's length and fixed paces. Nothing reads a clock, which is why two runs give the same video.
5. Captions, transcript and chapters are written from the script and the timeline.
6. `studio-helper assemble` draws every frame (cards, pictures, callouts, click circle, pointer) with the engine's canvas
   and Windows' text, mixes the narration, and writes the MP4 with the engine's video sink (Windows' own encoders).

## Decisions

Confirmed by Jason on 2026-11-14:

1. **Default voice: a downloadable local speech model.** Until one is chosen, the built-in Windows voice (the computer's
   default voice) is used: on every Windows computer, sends nothing anywhere, identical sound every time, but flat and
   16,000 samples a second. Each candidate model's weights and its text-to-sound front end need a licence audit before
   anything is downloaded or bundled (several common front ends are GPL). The shortlist is in `docs/voice-models.md`.
2. **First product: OpenStage Author.** The hook was built and proven in an invented program first (Practice Planner,
   `sample-program/`). Next it goes into Author's web-based editor, with a library of invented demo courses.
3. **Still pictures, not a live recording.** The take saves a still picture after each change, and the video's timing
   comes from the narration. That is what makes the video repeat exactly, and the real mouse can never spoil a take. The
   cost: a program's own animations (a menu sliding open) are not shown; changes appear as cuts, with a short fade for
   cards and opening a project. The spec's "one continuous pass" is kept in the sense that the program runs once, start to
   finish.
4. **No product names in the copied engine either.** Studio's copy is reworded (`capture/IMPORT-MANIFEST.md`); the same
   edits go into Author's copy so the two stay identical. One registry path the code needs stays as it is.

Made by Claude, open to change:
1. **The text caret is hidden in demo mode** (so a blinking caret cannot make two takes differ). Typing still shows
   letter by letter.
2. **The encoder is Windows' own** (H.264 and AAC through OpenScreen's video sink). No FFmpeg, nothing to licence. This
   answers the spec's encoder question for Windows.
3. **Where the player runs.** In this phase it runs as a Node script behind `Make Video.bat`. Moving it into the app
   window (a Make video button, with progress) is the next step for the app itself.
4. **Project file.** Scripts are separate JSON files with a shared `studio-project.json` (voice, pronunciations, paces).
   The spec's one-file project per product waits for its open question (narration audio makes it large).
5. **Paces.** Pointer travel 450 to 1300 ms, 65 ms a typed character, 0.45 s between steps, title card at least 3 s,
   end card at least 4 s. All adjustable in `studio-project.json`.

## Next

- Choose the local voice model from the audited shortlist (`docs/voice-models.md`), then build its download (progress, resume, cancel) and narration engine.
- OpenStage Author: the hook is on Author's local branch `studio-demo-hook` (not pushed; see docs/demo-hook.md). Still to do there: name the buttons in its panes and dialogs, keep demo mode out of the author's list of recent projects, and write the Author tutorial scripts.
- Put the player in the app window: open a script, make the video, show progress, play the result.
- Phase 2: demo workspace rules, blocklist, script scan, frame scan, review gate, guard report, publishing package.

## Things to know

- `Make Video.bat` uses display 1. `node src/pipeline/make-video.ts <script> --monitor 2` uses another.
- The practice program lays its page out at 1280 by 720 CSS pixels and is shown at 1920 by 1080, so text reads well at
  1080p whatever the display's own scale. `--layout-width` changes it.
- A display that is not 1920 by 1080 is recorded and fitted into the frame, with bars if its shape differs.
- Rendered output and narration clips go in `renders/` and `work/`, which git ignores.
