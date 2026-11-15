# OpenStage Studio

OpenStage Studio turns a finished software manual into short, narrated, captioned tutorial videos. You write (or an AI
helps write) a plain tutorial script; a player performs it in the real program; the video is assembled with narration,
captions, a pointer, click highlights and callouts. The same script always gives the same video, so a new release of a
program means a rerun, not a reshoot.

Free and open source under the Apache License 2.0. Part of the OpenStage suite. Windows first.

## Where this stands

Phase 1, "One video by hand", is built and passes its acceptance test: the hand-written script
`examples/plan-a-lesson.json` makes a narrated, captioned 1080p video of just under two minutes, and making it twice gives
the same video: with the Kokoro voice, every one of its 3,284 frames identical to the pixel and the sound identical (with
the Windows voice it runs 2:00, also identical).

| Built | Not built yet |
|---|---|
| The tutorial script format and its validator | The guard: blocklist, script and frame scans, review gate (phase 2) |
| The demo-mode hook, in an invented practice program | The hook in a real OpenStage program |
| The player and the take (window capture with OpenScreen's engine) | AI planning, scripting and rehearsal repair (phase 3) |
| Narration with Kokoro, a local speech model (or Windows' voices), pronunciation list, clip reuse | Hosted voices, recording your own voice |
| Captions (SRT and VTT), transcript, chapter list | The publishing package and thumbnail (phase 2) |
| Assembly to MP4 (1920 by 1080, 30 frames a second) with title and end cards | Making videos from inside the app window (today: `Make Video.bat`) |

## What to do (no typing needed)

1. **`Build Studio.bat`** builds everything. The first time takes several minutes.
2. **`Get Voice.bat`** downloads the narration voice once (340 MB, checked file by file). Narration works offline after that.
3. **`Make Video.bat`** makes the example video. Drag any script's `.json` file onto it to make that one instead. The
   finished video, its captions, transcript and chapter list land in `renders\<script name>\`.
4. **`Check Same Video.bat`** is the acceptance test: it makes the video twice from scratch and checks both are the same.
5. **`Run OpenStage Studio.bat`** opens the app, which checks a script against the format and lists its steps.
6. **`Test Everything.bat`** runs every automated test. **`Check Licences.bat`** checks every package's licence.
7. **`Make App Icons.bat`** rebuilds the app icons from `OpenStage_Studio_Icon.zip` (or the `branding` folder).

You need Node.js (22.13 or newer) and Rust installed. While a take runs, the practice program fills one screen for a minute
or two (the main one, or the one `local-settings.json` names, such as `{ "monitor": 2 }`); it ignores the mouse and the
keyboard, so nothing you do spoils the recording.

## How it fits together

```
examples/plan-a-lesson.json   a hand-written tutorial script
src/script/                   the script format and the validator
src/narration/                which lines are spoken, pronunciations, clip names
src/pipeline/                 the player, the hook server, the helper runner, make-video and the repeat check
src/timeline/                 the timeline builder: every picture, pointer move, click, callout and clip on a frame
src/captions/                 SRT, VTT, the transcript and the chapter list
demo-hook/                    the demo-mode hook a program includes (docs/demo-hook.md)
sample-program/               Practice Planner, an invented program used for the tests and the example
studio-helper/                the native part (Rust): window pictures, speech, drawing and the MP4
capture/                      OpenScreen's capture engine, copied from OpenStage Author (capture/IMPORT-MANIFEST.md)
src-tauri/                    the app's shell
```

Read `docs/script-format.md` to write a script, `docs/demo-hook.md` to add the hook to a program, and `docs/HANDOFF.md`
for the decisions made so far and what comes next.

## Licence

Apache License 2.0. See `LICENSE` and `NOTICE`.
