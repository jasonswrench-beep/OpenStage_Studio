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

Phase 2, "Guard and package", is built too: a script that would show a blocked name is stopped before recording, the
text in every recorded picture is read and checked, a person reviews every flag and approves the video, and only then can
its upload package be exported (`docs/guard.md`).

Phase 3, "AI planning and scripting", is built as well, and AI stays optional: from one chapter of a manual (a
documentation project file or a PDF), an AI plans the videos, writes their scripts from the program's real controls,
rehearses them and repairs what fails, all as files you read and edit first (`docs/ai.md`). It runs on a built-in model
on this computer, or on a hosted service with your own key.

Phase 4, "Batch and re-record", is built: a whole manual records unattended overnight, and after a new version of a
program, a release check names the exact step in each script that no longer works (`docs/batch.md`).

Phase 5, "Reach", is built in part: an accessibility driver records programs without the demo hook, through the names a
screen reader reads (`docs/accessibility-driver.md`), and a connector lets an assistant you already use write and
rehearse scripts (`docs/connector.md`).

Since the development list of 2026-11-15, Studio also turns a **recording** made with an OpenStage recorder into a script
it performs again (`docs/recordings.md`), writes a **description track** beside the captions for viewers who cannot
see the screen (`docs/script-format.md`), and makes **lectures**: notes or a manual's chapter become slides and narration
you approve, then a video (`docs/lecture-format.md`). It builds on the OpenStage shared core (its capture code), and asks
the core for what it needs next in `CORE-REQUESTS.md`.

There is an installer: one setup file that installs Studio for you, with no administrator rights, and whose window does
every job the double-click files below do (`docs/release.md`). Installed, your work goes into `Documents\OpenStage Studio`.

| Built | Not built yet |
|---|---|
| The tutorial script format (version 2) and its validator | Scheduling a queue for a set time (start it by hand for now) |
| The demo-mode hook, in an invented practice program and in OpenStage Author (on a branch) | Canvas commands for Author's stage, and uploading from Studio (phase 5) |
| The player and the take (window capture with the shared core's capture engine) | Hosted voices, recording your own voice |
| Narration with Kokoro, a local speech model (or Windows' voices), pronunciation list, clip reuse | A signed, published release (the installer is built; signing waits for the owner's computer) |
| Captions (SRT and VTT), transcript, chapter list | Uploading from inside the app (packages are uploaded by hand) |
| Assembly to MP4 (1920 by 1080, 30 frames a second) with title and end cards | |
| The guard: blocklist, script scan, frame scan, review gate, guard report | |
| The publishing package: thumbnail, upload details, checklist | |
| Manual import (documentation project or PDF), AI planning, scriptwriting, rehearsal with repair, publishing details | |
| The unattended queue for a whole manual, and the release check | |
| The accessibility driver (no hook needed) and the connector for assistants | |
| The window: every job from its pages, by keyboard and screen reader (`docs/release.md`) | |
| A per-user installer that carries everything but the downloads (`docs/release.md`) | |
| Scripts from recordings (the shared capture format) | Spoken audio description (waits for the shared speech engine, C5) |
| A description track (`descriptions.vtt`) for every video | |
| Lectures: slides drawn by Studio, narration, captions, descriptions | |

## What to do (no typing needed)

1. **`Build Studio.bat`** builds everything. The first time takes several minutes.
2. **`Get Voice.bat`** downloads the narration voice once (340 MB, checked file by file). Narration works offline after that.
3. **`Make Video.bat`** makes the example video. Drag any script's `.json` file onto it to make that one instead. The
   finished video, its captions, transcript and chapter list land in `renders\<script name>\`.
4. **`Review Video.bat`** opens the newest video's review: decide every flag the scans raised, then approve the video.
5. **`Export Packages.bat`** makes the upload package of every approved video in `packages\`, with a checklist.
6. **`Edit Blocklist.bat`** opens your own blocklist (names of other companies' products, real people and institutions).
   It stays on this computer; git ignores it.
7. With AI (optional): **`Set Up AI.bat`** chooses the AI (the built-in model, 2.8 GB once, or a hosted service with your
   own key). **`Plan Videos.bat`** (drag a manual onto it) plans videos from one chapter into a `series` folder; approve
   them in its `plan.json`. **`Write Scripts.bat`** and **`Rehearse Scripts.bat`** (drag the series folder onto them) write
   and rehearse the scripts.
8. Many at once: **`Run Queue.bat`** records unattended (drag a manual onto it to do the whole manual, or series folders
   and scripts), skipping videos already made. After a new version of a program, **`Release Check.bat`** names the step
   in each script that no longer works.
   **`Set Up Connector.bat`** turns on the connector for an assistant you use, for one folder you name.
9. **`Check Same Video.bat`** is phase 1's acceptance test: it makes the video twice from scratch and checks both are the
   same. **`Check Guard.bat`** is phase 2's: a blocked name is stopped, a planted path is flagged, export stays shut.
   **`Check AI Scripts.bat`** is phase 3's: from one manual chapter, at least four in five AI scripts pass rehearsal.
   **`Check Batch.bat`** is phase 4's: a manual records unattended, and the release check names the exact broken steps.
   **`Check Reach.bat`** is phase 5's: a program without the hook records, and a hosted AI writes and rehearses a script
   through the connector.
10. **`Run OpenStage Studio.bat`** opens the app. Its pages do everything above: make a video, review, plan and write
    from a manual, the queue, the release check, AI, the connector and settings.
11. **`Test Everything.bat`** runs every automated test. **`Check Licences.bat`** checks every package's licence.
12. **`Make App Icons.bat`** rebuilds the app icons from `OpenStage_Studio_Icon.zip` (or the `branding` folder).
13. **`Build Installer.bat`** makes the setup file (not signed, for checking), **`Check Engine.bat`** runs the bundled
    engine the way the installed app does, and **`Test Installed App.bat`** installs the setup, works the installed window
    through Windows' accessibility interface, and uninstalls it (`docs/release.md`).
14. **`Script From Recording.bat`** (drag a `.capture` folder onto it) turns a recording into a script; **`Check
    Recording.bat`** is its acceptance test. **`Write Lecture.bat`** (drag notes or a manual), **`Approve Lecture.bat`** and
    **`Make Lecture.bat`** make a lecture video; **`Check Lecture.bat`** is their acceptance test. `TESTING-TODO.md` lists
    what only a person can check.

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
src/guard/                    the blocklist, the script and frame scans, the review gate and the guard report
src/package/                  the publishing package: upload details, thumbnail plan, export and checklist
src/review/                   the review screen in the app window
src/manual/                   reading a manual: a documentation project file or a PDF
src/ai/                       the AI choice, the built-in model, the four AI roles, rehearsal and the series commands
src/batch/                    the unattended queue and the release check
src/connector/                the connector (MCP server) for assistants, its setup and its acceptance test
src/recording/                a recording (the shared capture format) becomes a script Studio performs again
src/lecture/                  lectures: the format, writing from notes or a manual, approval, and making the video
src/engine/                   the engine: every job the window starts, by name (bundled into the installer)
src/app/                      the window's pages and its job area
src/paths.ts                  where things are: the app's own files, a person's work, the downloads
examples/manuals/             an invented manual for the practice program (written by tools/make-practice-manual.ts)
demo-hook/                    the demo-mode hook a program includes (docs/demo-hook.md)
sample-program/               Practice Planner, an invented program used for the tests and the example
studio-helper/                the native part (Rust): window pictures, speech, drawing, the MP4, reading text, thumbnails
src-tauri/                    the app's shell (src-tauri/src/engine.rs runs the engine's jobs for the window)
tools/build-installer.mjs     the installer build; tools/release-smoke.mjs tests the installed app
```

Read `docs/script-format.md` to write a script, `docs/demo-hook.md` to add the hook to a program, `docs/guard.md` for
the guard, the review and the package, `docs/ai.md` for AI planning and scripting, `docs/batch.md` for the queue and
the release check, `docs/accessibility-driver.md` and `docs/connector.md` for phase 5, and `docs/HANDOFF.md` for the decisions made so far and what comes next.

## Licence

Apache License 2.0. See `LICENSE` and `NOTICE`.
