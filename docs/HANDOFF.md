# Handoff

Last updated 2026-11-16, after the development list round (recordings, description track, lectures).

## Where things are

Phases 1 to 5 are built (phase 5 in part: the driver and the connector), and their acceptance
tests pass on the owner's computer (Windows 11; takes run on the second display).

Phase 1, "One video by hand":

- `examples/plan-a-lesson.json` (23 steps) makes a 109.5 second video with the Kokoro voice (120.0 seconds with the
  Windows voice), 1920 by 1080, 30 frames a second, H.264 with AAC sound, with captions (SRT and VTT), a transcript and a
  chapter list.
- `Check Same Video.bat` makes it twice from scratch and compares the take's pictures, the timeline, every frame and
  sound sample given to the encoder, and the two finished MP4 files read back with Windows' decoder. Last run 2026-11-15,
  after the phase 3 changes (hook version 3, grey text smoothing): 3,284 of 3,284 frames identical to the pixel and the
  sound identical; Author's first look 1,105 of 1,105.
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
- Phase 2 added no packages (text recognition is part of Windows).

Phase 3, "AI planning and scripting" (`docs/ai.md`):

- `Check AI Scripts.bat` passes with the built-in model (Qwen 3.5 4B on this computer): from the "Planning lessons"
  chapter of the invented Practice Planner manual, it planned six videos, wrote six scripts, and all six passed rehearsal
  after automatic repair, with no hand edits (the bar is four in five). See "Phase 3 results" below.
- It also passes with a hosted AI service (the owner's own key, 2026-11-15): six videos planned, six scripts written,
  all six passed rehearsal at the first run with no repairs, and on reading, every script does what its task says.
- The licence check passes with phase 3's two packages (a hosted service's own library and the PDF reader, both Apache 2.0, in NOTICE).

Phase 4, "Batch and re-record" (`docs/batch.md`):

- `Check Batch.bat` passes with a hosted AI service (2026-11-15). The whole invented Practice Planner manual recorded unattended: the
  chapter with no tasks was left out, and all six planned videos were planned, written, rehearsed and recorded with
  nobody at the computer. Then, against Practice Planner version 2 (two controls renamed), the release check named the
  exact broken step in all seven scripts checked (the six new ones and `examples/plan-a-lesson.json`): three broken, at
  the steps worked out independently, and four still working.
- The AI's repaired copies were right on reading: they use the renamed controls, change the narration only where the
  words on screen changed, and leave every other step as it was. A repair may now reach past the failed step to fix the
  same problem later in a script (the hand-written example uses one renamed control twice and the other once later).
- `Check Same Video.bat` still passes after phase 4, with the same frame fingerprint (version 1 of the practice program
  is unchanged).
- Phase 4 added no packages.

Phase 5, "Reach", in part (`docs/accessibility-driver.md`, `docs/connector.md`):

- `Check Reach.bat` passes (2026-11-15). Practice Planner, started with its hook off, recorded a whole video through
  the accessibility driver (11 steps, 54.8 seconds). A hosted AI service (the owner's key), given only the connector's
  tools over the connector's own protocol, listed the files and programs, read the manual and the real controls, checked
  and wrote a script for "Making a new lesson", and rehearsed it: it passed first time, and Studio's own rehearsal of it
  passed too. The script is right on reading.
- The accessibility example gave the same video to the pixel twice (`Check Same Video.bat`, all 1,643 frames), better
  than the agreed "same to the eye"; the hook example's fingerprint is unchanged.
- 105 TypeScript tests and 20 helper tests pass (`Test Everything.bat`). Phase 5 added no packages.

The installer and the window (`docs/release.md`, `docs/code-signing.md`):

- The window's pages do every job the double-click files do (Home, Make a video, Review, From a manual, Queue, Release
  check, AI, Connector, Settings), each through the engine (`src/engine/main.ts`). Tried on the second display through
  Windows' accessibility interface: every page opens by its name, every control has a name, and the example video was
  made from the window and its review opened.
- `src/paths.ts` separates the app's own files from a person's work. From the repository nothing changes; installed, the
  work goes into `Documents\OpenStage Studio` and the downloads into `%LOCALAPPDATA%\org.openstage.studio` (moved there
  from the old folder the first time).
- `Check Engine.bat` passes: the bundled engine, run from a folder laid out like the install folder with empty settings,
  made the example video with the same frames as the repository, and the connector answered through it.
- `Build Installer.bat` makes `OpenStage-Studio-0.1.0-alpha.1-Setup.exe` (42.5 MB, not signed) and its checks pass.
  `Test Installed App.bat` passes: installed silently, every page opened by its name with every control named (through
  UI Automation), the take screen set on Settings, the example video made from the installed window and its review
  opened, then uninstalled with the work folder and the downloads kept.
- Building the window found that a take started from the window got a blank practice program: the two shared one
  browser data folder with different settings, which the browser engine refuses. Studio's window now starts with exactly a
  take's settings (`BROWSER_SETTINGS` in `src-tauri/src/main.rs`, kept equal to `TAKE_BROWSER_SETTINGS` by a test). A
  separate data folder and software-only drawing were tried first and dropped: each let rounded corners differ by a
  brightness level from run to run (docs/release.md). The example's frame fingerprint is a142ffff977482cd since the
  browser engine update of 2026-11-25 (docs/release.md). Before it the fingerprint was 81d41989e3de3093 (before the
  installer work cffdaa5f8dc08793), the same from the repeat check and from the window; the new one is measured from the
  repeat check only so far.
- `check-repeat.ts` now compares an accessibility take's timeline with the pictures' names set aside: the timing must
  match, and the pictures need only be the same to the eye (as agreed), which the comparison of the finished videos judges.
  Before, one picture differing by one brightness level on a corner failed the timeline as well.

The development list round of 2026-11-15/16 (the "OpenStage Studio Development List" and the shared core's
`CORE-NOTES.md`):

- **The shared core.** Studio's own copy of the capture code is gone; the helper depends on the core's tag
  `capture-v0.1.0` (identical code). What Studio needs from the core is in `CORE-REQUESTS.md` (C5 for spoken description,
  C1's description track, "send to", an automation id in the log). PrismQDA's switch to the core's statistics tag was left
  to PrismQDA's own session (Jason's choice).
- **Item 1, recordings** (`docs/recordings.md`). `Check Recording.bat` passes: the invented example recording becomes the
  nine steps it shows, every control found in Practice Planner by its stable id, what was done in another program left
  out, and the video made from it twice is identical to the pixel (1,016 frames).
- **Item 2, the description track** (`docs/script-format.md`, format version 3: a step's `describe`). Every video gets
  `descriptions.vtt` and the transcript carries the descriptions; packages include the file. Spoken description waits for
  C5.
- **Item 3, lectures** (`docs/lecture-format.md`). Notes or a manual's chapter become a lecture (fixed rules, or the AI),
  a person approves it, and Studio draws the slides (helper `slides`) and makes the video through the same `makeVideo`.
  `Check Lecture.bat` is its acceptance test.
- The window gains From a recording and Lecture pages. `TESTING-TODO.md` lists what only Jason can check.

### Phase 3 results, and what the built-in model gets wrong

Rehearsal passing means every step can be performed and none types onto a box's old words. It does not prove each step
does what its narration says, and the built-in model's scripts still need a person's read:

- It reads the program's real controls well: lesson numbers, opening a menu or dialog first, typing a list's choice.
- On the last run (2026-11-15) all six scripts did exactly what their tasks say, after two automatic repairs (typing into
  the checklist's new item, and selecting the copy's title before renaming it).
- An earlier slip: in "Copy a lesson", it clicked the original lesson after Duplicate and renamed that instead of the
  copy, and rehearsal could not see it. Practice Planner's notes for the AI now say Duplicate opens the copy at once,
  which fixed it; slips of this kind are why a person reads every script.
- Asking it to judge each step's `expect` against what changed on screen was tried and dropped (it flagged ordinary
  changes and its repairs made scripts worse). Fixed rules catch the real mistakes instead: clicking a drop-down list to
  choose from it, typing onto a box's old words, and a step repeated by mistake (tidied away).

## How a video is made

1. The script is checked (`src/script/validate.ts`); a version 1 script is read as version 2 (`src/script/migrate.ts`).
2. The script scan checks every word a viewer will see or hear against the blocklist (`src/guard/script-scan.ts`). A hit
   stops here, before anything is recorded.
3. Narration: one clip per line with Kokoro (or a Windows voice) in `studio-helper speak`. A clip's file name comes from
   the voice and the words as spoken, so changing one line makes one new clip.
4. The take: the program starts full screen in demo mode on the chosen display; `studio-helper take` watches its window
   with the shared core's capture engine (C1); the player (`src/pipeline/player.ts`) performs each step through the hook and saves a
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

- **The development list round** (2026-11-15): a recording becomes a script Studio performs again (not narration over the
  recorded video); the description track is text now, its voice waits for C5 (asked in `CORE-REQUESTS.md`, nothing built
  in Studio's own speech path for it); Studio draws a lecture's slides itself; PrismQDA's statistics switch is left to its
  own session. Every lecture is approved by a person before its video, whoever wrote it ("a script you approve").

- **The installer** (2026-11-15): signed the way OpenExplainer is (a cloud signing service, with the suite's shared
  `tools/sign_windows.py`, on Jason's computer only); a person's work in `Documents\OpenStage Studio`; the first
  installer's window does all the jobs. Node.js is carried in the installer (pinned in `tools/node-runtime.json`, v24.22.3,
  the 24 line Studio is developed on); the voice and the model still download on request. The first release,
  `0.1.0-alpha.1`, is published as a signed pre-release (2026-11-16, commit `fe2033b`; `docs/code-signing.md`).

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
10. **AI: the built-in model plus your own key** (2026-11-15), matching the documentation tool. The connector server waits
    for phase 5, as the spec says. The built-in model is the documentation tool's pinned Qwen 3.5 4B and llama.cpp build.
11. **Naming** (2026-11-15): the rule is about positioning. Never compare Studio to products on the market or call it a
    replacement for one; naming a service Studio works with directly, such as the hosted AI services, is fine.
12. **Phase 3 is proven on an invented Practice Planner manual** (2026-11-15), written as a documentation project file;
    imports are documentation project files and PDFs.
13. **Plain grey text smoothing in demo mode** (2026-11-15): Studio starts every program in demo mode with its browser
    engine told not to use coloured (subpixel) smoothing, which could switch for a label beside a control drawn in its own
    layer and made two takes differ. Set at launch (`src/pipeline/programs.ts`), so no program's own code changes. Studio's own
    window starts with the same settings, so the two share one browser data folder (2026-11-15).
14. **The unattended queue records every script that passes rehearsal** (2026-11-15), including AI-written scripts a
    person has not read; the review gate before export is the person's check.
15. **The release check reports broken steps only** (2026-11-15), not steps whose pictures merely changed.
16. **Batch repairs are proposed, never recorded** (2026-11-15): an existing script is never changed; the AI's repair is
    saved beside it as `<name>.repaired.json` for a person to read.
17. **An unattended run is started by hand** (2026-11-15), with a double-click; it keeps the computer and screen awake,
    and carries on where it stopped.
18. **Phase 5 now: the accessibility driver and the connector** (2026-11-15). Canvas commands for Author's stage and
    direct upload wait.
19. **The accessibility driver is proven on Practice Planner with its hook off** (2026-11-15), and its takes need only be
    the same to the eye (every frame at least 40 dB alike).
20. **The connector follows the documentation tool's pattern** (2026-11-15): off until turned on, one named folder; its
    acceptance test has a hosted AI service, with the owner's key, act as the outside assistant.

Made by the AI assistant, open to change:

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
13. **AI output goes into a series folder** (`series\<program>-<chapter>\`, which git ignores): `plan.json`, the scripts and
    `rehearsal.txt`. A person approves videos by setting `status` in `plan.json`; `Write Scripts.bat` writes the approved
    ones (or, with `--all`, every proposed one, as the acceptance test does).
14. **The scriptwriter sees the program's real controls**, read through the hook with each demo project open, plus the
    numbered families and notes in `src/pipeline/programs.ts`. Every AI answer is checked and sent back with the problems
    in words until it passes (up to three or four tries).
15. **Rehearsal flags typing onto a one-line box's old words** unless Ctrl+A selected them first (hook version 3 reports
    a box's words and makes Ctrl+A select them). Writing refuses clicking a drop-down list to choose, and tidies away a
    step repeated by mistake.
16. **Publishing details**: the metadata writer is told the program's name; chapters only for scripts of eight steps or
    more, at least two steps apart, as video sites need three chapters of ten seconds or more.
17. **The first hosted service** goes through its own library, with medium effort and the service's own fallback on a
    refusal. Keys are kept in `%APPDATA%\org.openstage.studio\ai.json`, encrypted by Windows for the person signed in.
18. **AI setup is a double-click console script for now** (`Set Up AI.bat`): asked in words, one question at a time, so a
    screen reader can follow it. An AI settings screen in the app comes with moving the player into the app.
19. **Videos from the queue go into `renders\<series>-<script>\`**, one flat folder each, so `Review Video.bat` and
    `Export Packages.bat` find them as they find any video. `renders\queue-state.json` remembers which script version each
    was made from.
20. **The release check checks a script's format alone before performing it**, so a lost control fails at its own step;
    a script stops at its first broken step, since later steps depend on it.
21. **Practice Planner version 2** (`sample-program/versions.ts`) renames two controls, for the acceptance test only;
    it is started with `--sample-version 2` (Studio: `PRACTICE_PLANNER_VERSION=2`). Version 1 is unchanged.
22. **A chapter of a documentation project with no numbered steps gets no videos** without asking the AI; the planner
    may also answer that a chapter has no tasks.
23. **Accessibility targets are automation ids**, with a step's `fallback` `{role, name}` for a control with none. No format
    version change: version 2 already had `driver` and `fallback`; Studio now accepts `"accessibility"`, and refuses its
    key, scroll and open steps with the reason (they would need the real keyboard or mouse).
24. **Without the hook, a program's window never takes the keyboard** (`--open-demo` makes Practice Planner's window
    unfocusable), after real typing landed in a take while the window had the foreground. Clicking into a text box or
    list only places the drawn pointer, so no cursor blinks in the pictures.
25. **The connector's tools** are listing programs, controls and files, reading manuals and scripts, checking, writing
    and rehearsing scripts. No recording through it: a person makes the video from a script it wrote.
26. **The connector speaks the protocol itself** (JSON lines on standard input and output), as the documentation tool's
    does, with no added package.
27. **A take may film the whole take screen** (Jason, 2026-11-26, for the OpenStage Capture course: "Film the take screen").
    A program entry with `film: "screen"` is filmed as the display it fills (`studio-helper take --film screen`), because
    OpenStage Capture hides its window while it captures and shows its own Cancel and Stop windows. Its `companions` (Tea
    Timer, with a plain backdrop over the whole display) open before it. A step with `window` (script format 4) works a
    control in another program's window through Windows' accessibility interface (`src/pipeline/outside.ts`,
    `studio-helper uia` `locate` and `press`), still never the real mouse or keyboard; a click first tells the program
    where it lands (`outsideClick`, hook version 11), so a program that records clicks records it. While the program's
    window is hidden the player does not ask its page to settle or for its text (hook version 11 also copes by itself).
    Hook 11 also adds a rule it never rewrites that keeps the browser's own focus ring off unmarked controls (it came and went
    with which window was active). Checked 2026-11-26: `Check Same Video.bat` (plan-a-lesson, 3,284 frames identical) and
    the OpenStage Capture course's `series/smoke/capture-clicks.json` made twice with every frame identical.

## Next

- `TESTING-TODO.md`: watch the recording and lecture videos, try a real recording, a screen reader on the new pages, the
  checks that spend the hosted AI key.
- When the core publishes C5 (or C1's description track, or "send to"), build on it as `CORE-REQUESTS.md` says.

- OpenStage Author: the hook is on Author's branch `studio-demo-hook` (pushed, not merged). Still to do: name the
  buttons in its panes and dialogs, list its demo projects in `src/pipeline/programs.ts`, write its manual (or import
  one), and make its videos.
- The next release: raise `RELEASE` in `tools/build-installer.mjs`, build it with `--sign` and test it as
  `docs/code-signing.md` says; publishing is Jason's call each time.
- A short pass with a real screen reader on the window's new pages.
- The rest of phase 5: canvas commands for Author's stage (hook commands in Author's repository), and direct upload to a
  video site (always private; the site's current upload rules to be confirmed first).
- Try the connector from Jason's own assistant: `Set Up Connector.bat`, then add the lines it shows.

## Things to know

- **Takes do not depend on the computer's state.** In demo mode the hook rewrites the page's own focus and hover rules to
  follow markers it sets, keeps track of the keyboard focus itself, draws drop-down lists itself, and gives them their own
  layer; the take waits five seconds for a program to finish starting; and the program is started with plain grey text
  smoothing, the same settings as Studio's own window, so the two share one browser data folder. If a repeat check ever fails, the take log shows the first picture that differs.
- The built-in AI model and its runtime live in `%LOCALAPPDATA%\org.openstage.studio\ai\` (the voice beside it in `voices\`); writing one script with it takes a
  minute or two on this computer's processor, and a whole chapter's run about 25 minutes. With a hosted service a whole chapter's
  run took about 10 minutes, most of it rehearsal.
- When an AI assistant runs Studio's commands from inside a packaged desktop app, Windows keeps anything it writes under
  AppData in that app's private folder: the AI settings, the voice and the model it downloads there are not the ones
  Studio sees when run by double-click. Studio itself, run normally, is not affected. `Copy Downloads.bat` copies the
  voice and the model from such a private copy to where Studio looks, checking every file against its pinned fingerprint.
- The window's pages start the engine; from the repository that is `node src/engine/main.ts` (Node.js on the PATH), installed it
  is the carried `node
ode.exe` with `engineengine.mjs`. A plain `cargo build --release` in `src-tauri` makes a program that
  loads its pages from the development server, which also breaks takes; build with `Build Studio.bat`.
- `local-settings.json` (git ignores it) holds settings for this computer only: `{ "monitor": 2 }` puts takes on the second
  display, which is how Jason's computer is set up. Every double-click script follows it; `--monitor <n>` overrides it.
  The app's own window also takes `--monitor <n>` (used for tests).
- The practice program lays its page out at 1280 by 720 CSS pixels and is shown at 1920 by 1080, so text reads well at
  1080p whatever the display's own scale. `--layout-width` changes it.
- Text recognition needs Windows' English text recognition, which comes with English Windows. The helper says plainly
  if it is missing.
- Rendered output, narration clips and packages go in `renders/`, `work/` and `packages/`, which git ignores.
