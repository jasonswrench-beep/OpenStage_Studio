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
- In demo mode the page holds still and ignores the real mouse: transitions and animations are off, the text caret does
  not blink, and pointer events are switched off so a resting or stray mouse cannot change what is recorded. The hook's
  own clicks are unaffected.

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
| `list` | Lists every named control: name, label, role, place, whether it is visible and switched on. |
| `position` | The place of one control, for the pointer, the click circle and callouts. |
| `hover` | Gives a control its hover look (`data-demo-hover`), or clears it. |
| `click` | Presses a control, with the pointer and mouse events a click sends. |
| `focus` | Gives a control the keyboard focus. |
| `type` | Types text one character at a time with key events, or chooses a drop-down option by its words. |
| `key` | Presses a key or chord on the focused control; Tab, Enter, Space and Backspace do what a browser would. |
| `scroll` | Scrolls a control or the page by a number of pixels. |
| `loadDemo` | Opens a demo project from the program's demo library, by name. |
| `reset` | Puts the program back to a known state. |
| `settle` | Waits for fonts, any running animations and two drawn frames, so a still picture shows the finished result. |

## Programs with the hook

| Program | Status |
|---|---|
| Practice Planner (the invented sample in `sample-program/`) | Built in; used for the tests and the example. |
| OpenStage Author (the first product, chosen 2026-11-14) | On the local branch `studio-demo-hook` of Author's repository, not pushed: `editor/src/demohook/` (a copy of this folder), `editor/src-tauri/src/demo.rs` (the launch flags), every menu and menu command named from its key in Author's command table (`menu.insert`, `menu.insert.add-text`, `menu.help.keys`), and the examples as its demo library (`minimal`, `lesson-parts` and the rest). `examples/author/first-look.json` is its first script. Buttons in panes and dialogs are not named yet. |
