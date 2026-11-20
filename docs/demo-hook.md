# The demo-mode hook

The demo-mode hook lets OpenStage Studio's player perform scripts inside a program. It is the most reliable of the three
drivers in the spec, and the only one built so far. It lives in `demo-hook/`: `protocol.ts` (the messages, shared by both
sides) and `hook.ts` (the part a program includes).

## Rules

- Off by default. The hook starts only when the program is launched with the demo flag, which makes its shell set the
  page global `__OPENSTAGE_DEMO_HOOK__` (or the page address carries `?demo-hook=...&demo-token=...`).
- It only talks to this computer (`127.0.0.1`, `localhost` or `[::1]`), and every request carries a one-time token the
  player made for the take. Anything else is refused on both sides.
- Controls are found by stable names, never by their visible labels. Rewording a button does not break a script.
- The hook also works inside the program's own frames (the same origin, such as OpenStage Guide's tools pane): their named
  controls are listed, found, pressed and typed into, their text is read for the frame scan, and every place is reported
  on the program's page. A frame that opens later is put in demo mode the first time the hook is asked anything after it
  appears. Frames from other sites cannot be reached and are left out. Tab moves within the page or frame that has the
  focus.
- In demo mode the page holds still and ignores the real mouse: transitions and animations are off, the text caret does
  not blink, and pointer events are switched off so a resting or stray mouse cannot change what is recorded. The hook's
  own clicks are unaffected.
- In demo mode the page also behaves the same whether or not its window is the active one: the focus and blur events a
  window that is not in front never gets are sent by the hook (version 6). And it looks the same: the hook rewrites the page's own
  `:focus`, `:focus-visible`, `:focus-within` and `:hover` rules to follow markers it sets (`data-demo-focus` and the
  rest), keeps track of the keyboard focus itself from every focus() and blur() call, and draws drop-down lists itself
  (same box and colours, a plain arrow). A program does not need to do anything
  for this; step 3 below is now optional.
- Studio starts every program in demo mode with its browser engine set to plain grey text smoothing (not the coloured
  kind), because the coloured kind can switch for text beside a control drawn in its own layer
  (`demoEnvironment` in `src/pipeline/programs.ts`). A program's own code does not change.

## Adding it to a program

1. Copy `demo-hook/` into the program (it has no dependencies), or import it from a shared package.
2. Mark every control a tutorial may use with a stable name:
   `<button data-demo-id="toolbar.lesson.new">New lesson</button>`.
   Use dotted names by area: `toolbar.*`, `menu.*`, `dialog.<name>.*`, `editor.*`, `sidebar.*`.
3. Give hovered controls the same look under `[data-demo-hover]` as under `:hover`, so the pointer arriving shows it.
4. At start-up, call the hook with the program's demo-project loader and a reset:

   ```ts
   import { startDemoHook } from "./demo-hook/hook.ts";
   startDemoHook({ program: "Practice Planner", loadDemo: (name) => openDemo(name), reset: () => closeDialogs() });
   ```

5. In the program's shell, read `--demo-hook <endpoint> --demo-token <token>` from the command line and, only when both are
   present and the endpoint is on this computer, set the page global before the page's scripts run. `src-tauri/src/main.rs`
   does this for the practice program with Tauri's initialization script.
6. Allow the page to reach `http://127.0.0.1:*` in its content security policy.
7. Build a small library of invented demo projects (made-up names, original text, images you own) and load them by name.
8. Add the program to `src/pipeline/programs.ts`: how to launch it with the flags, and part of its window title.

## What the hook does

| Command | What it does |
|---|---|
| `hello` | Says the program's name, the hook version, the page size and how many named controls there are. |
| `list` | Lists every named control: name, label, role, place, whether it is visible and switched on, whether it has the keyboard focus, and for a box, the words in it now (never a password box's) and whether it takes several lines. |
| `position` | The place of one control, for the pointer, the click circle and callouts; with `words`, the place of those words inside it. |
| `hover` | Gives a control its hover look (`data-demo-hover`), or clears it. |
| `click` | Presses a control, with the pointer and mouse events a click sends. With `words`, the click lands on those words inside the control and selects them (on a page's text or in an editable area), so the next typing replaces them; with `caret` (`before` or `after`) it puts the cursor beside them instead. |
| `focus` | Gives a control the keyboard focus. |
| `type` | Types text one character at a time with key events, or chooses a drop-down option by its words. |
| `key` | Presses a key or chord on the focused control; Tab, Enter, Space and Backspace do what a browser would (Backspace and Delete also in an editable area), and Ctrl+A selects all of a box's words (a text box, a number box, or an editable area such as OpenStage Guide's box for a paragraph's words), so the next typing replaces them. A box typed into tells the page it changed (a `change` event) when Tab or Enter leaves it, or when another control gets the focus, as in a browser. |
| `scroll` | Scrolls a control or the page by a number of pixels. |
| `loadDemo` | Opens a demo project from the program's demo library, by name. |
| `reset` | Puts the program back to a known state. |
| `settle` | Waits for fonts, any running animations, the page (and its frames) to stop changing for 150 ms (at most 1.5 seconds, for a program that draws a moment after a click on a timer of its own), and two drawn frames, so a still picture shows the finished result. |
| `text` | Lists every piece of text the viewer can see, with where it is: the page's words, what is typed in fields (or their placeholder), and the choice showing in each drop-down list. Text hidden, scrolled out of view or clipped is left out. For the frame scan (docs/guard.md); it never changes the page. |

The hook's version is 6. Version 2 added `text`; version 3 added a box's words, its several-lines flag and the focus to
`list`, and Ctrl+A; version 4 reaches the program's own frames, with no command changed (`Check Same Video.bat` passed
after it, 2026-11-19: every one of the 3,284 frames identical); version 5 clicks on words inside a control (`click` and
`position` with `words` and `caret`, a script step's `words` and `caret`), and Backspace and Delete work in an editable area. A script that
clicks on words needs version 5; the player refuses it with an older hook. Version 6 (2026-11-20) also sends the focus
and blur events (and focusin, focusout) that a window which is not the active one never gets, when the focus moves by the
hook or by the program's own focus() and blur(): without them Prism Transcribe's editor never learned which turn had the
cursor, so a note or a timestamp went nowhere. In version 6 a click's pointer and mouse events also carry what a real
click's carry: the point they land on (the middle of the control, or the words) and the mouse as the kind of pointer. React
Aria's tick boxes count a press only when the button comes up over them, and ignore a click with no pointer, so Prism
Transcribe's tick boxes never ticked before. No command changed. Studio asks a program with an older hook for nothing it lacks: the frame scan then reads the pictures
only, and rehearsal skips its check on typing into a box that already holds words (docs/ai.md).

## Programs with the hook

| Program | Status |
|---|---|
| Practice Planner (the invented sample in `sample-program/`) | Built in; used for the tests and the example. |
| OpenStage Author (the first product, chosen 2026-11-14) | On the branch `studio-demo-hook` of Author's repository (pushed; not merged into Author's main): `editor/src/demohook/` (a copy of this folder), `editor/src-tauri/src/demo.rs` (the launch flags), every menu and menu command named from its key in Author's command table (`menu.insert`, `menu.insert.add-text`, `menu.help.keys`), and the examples as its demo library (`minimal`, `lesson-parts` and the rest). `examples/author/first-look.json` is its first script. Buttons in panes and dialogs are not named yet. |
| OpenStage Guide (chosen 2026-11-19) | On the branch `studio-demo-hook` of Guide's repository (not merged): `program/ui/demo-hook.js` and `demo-protocol.js` are made from this folder by Guide's `scripts/demo-hook-sync.mjs`, never edited by hand; `shell/src-tauri/src/demo.rs` (the launch flags); every menu, menu command and button of the navy bar named from its command's id (`menu.file.newGuide`, `bar.reviewGuide`); its demo guides in `demo/`. Its tools pane is a frame of the page, reached since hook version 4. |
| Prism Transcribe (chosen 2026-11-19) | On the branch `studio-demo-hook` of Transcribe's repository (worktree `Prism_Transcription-demo`, not merged): `app/ui/src/demohook/` is made from this folder by `app/ui/scripts/demo-hook-sync.mjs`, never edited by hand; `app/src-tauri/src/demo.rs` (the launch flags, the workspace, the demo library in `app/demo`); `app/ui/src/pick.ts` answers every Windows file box with a place in the workspace, so a take never leaves the window. The main window's and Help's controls are named (`bar.settings`, `file.int-01.edit`); the editor's are not yet. |
