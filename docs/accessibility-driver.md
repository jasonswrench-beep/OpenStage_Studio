# The accessibility driver (phase 5)

The accessibility driver records a program that has no demo-mode hook. It finds the program's controls the way a screen
reader does, through Windows UI Automation, and works them through the same interface: pressing a button, setting a
box's words, choosing from a list. The real mouse and keyboard are never used. The code is `studio-helper/src/uia.rs`
(the helper's `uia` command) and `src/pipeline/accessibility.ts`, which answers the player as the hook does, so takes,
rehearsal, the queue and the release check all work with it unchanged.

A side benefit, as the spec says: a script that passes rehearsal through this driver is evidence that the program's
controls carry proper accessible names.

## Writing a script for it

Set `"driver": "accessibility"`. Then:

- **`target` is the control's automation id**: the stable programmatic name Windows reports for it. In a program built on
  the browser engine, that is the element's `id` attribute (Practice Planner's New lesson button is `new`). The
  connector's `list_controls`, with `driver` set to `accessibility`, lists them.
- **A control with no automation id is found by its role and its accessible name**: give the step a `fallback` instead of
  a target, `{ "role": "textbox", "name": "Item 1" }`. Names are what a screen reader reads, so rewording a label breaks
  these steps; prefer automation ids.
- **Actions:** `click`, `type` and `wait`. `type` adds the words to a box, or, for a drop-down list, chooses the choice
  with those words. Key presses, scrolling and opening another demo project partway are refused, because they would need
  the real keyboard or mouse; the program starts with the script's demo project.

`examples/accessibility/plan-a-lesson-no-hook.json` is a complete example.

## How a take runs

1. The program is started with the script's demo project open and **without its hook** (`launchPlain` in
   `src/pipeline/programs.ts`; for Practice Planner, `--open-demo <name>`). Its window is set so it never takes the
   keyboard, so typing meant for another program cannot land in it during a take.
2. The helper finds the window by its title and lists its controls.
3. The player performs each step through the interface. Clicking into a text box or a list only places the drawn
   pointer; typing needs no keyboard focus, and leaving the focus alone keeps a blinking cursor out of the pictures.
4. The take, timeline, narration and assembly are the same as with the hook. The frame scan reads the pictures only (this
   driver does not report the page's text).

## Repeatability

Agreed with Jason on 2026-11-15: through this driver, the same script must give a video **the same to the eye** (every
frame at least 40 dB alike, as the comparison judges), not necessarily to the pixel, because nothing holds the program's
own effects still. `Check Same Video.bat` applies that rule to accessibility scripts and says so. In practice,
`plan-a-lesson-no-hook.json` gave the same video to the pixel twice (2026-11-15), every one of its 1,643 frames.

## For a new program

Add `launchPlain(root, monitor, demo)` to its entry in `src/pipeline/programs.ts`: how to start it with a demo project
open, without its hook. Its window title is how the helper finds it.
