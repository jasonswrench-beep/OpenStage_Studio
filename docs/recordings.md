# From a recording

Built 2026-11-15 (development list item 1: Studio reads C1 recordings as well as manuals). Jason's decision: a recording
becomes a script that Studio performs again, so the video is repeatable and can be made again after a new version of the
program; the recording's own pictures are not used.

## What it does

A recording made by an OpenStage recorder (OpenStage Recorder or OpenStage Author) is a folder named
`something.capture`, in the shared capture format (C1, the core's `specs/capture`). With its interaction log turned on,
each take holds `events.jsonl`: the window in front, each click with the name and role of what was clicked (from Windows'
accessibility information), the keys pressed in ordinary text fields, and the author's markers.

`Script From Recording.bat` (drag the folder onto it), or **From a recording** in the window:

1. **Reads the recording** with the shared core's own reader (`studio-helper recording`, built on
   `openstage-capture-project`): the manifest is checked as the recorders check it, and a log line cut short by a crash is
   skipped.
2. **Turns one take into steps** with fixed rules (`src/recording/to-script.ts`), no AI, so the same recording always gives
   the same draft:
   - a click on a named control (a button, a box, a list, a menu item...) is a click step on it;
   - a click into a box followed by typing is one type step (Backspace takes back a letter, as it did when typed);
   - a click on a drop-down list followed by a click on one of its choices is one type step that chooses it;
   - Enter, Tab, Escape, the arrows and shortcuts such as Ctrl+S are key steps;
   - a marker starts a chapter there.
   The take used is the one named, or the last finished take that holds clicks.
3. **Finds every control in the program** (`src/recording/import.ts`): Studio opens the program through its demo-mode hook
   on the take screen, performs the steps, and before each one finds the control with the recorded role and name on
   screen and writes its stable id into the step. Nothing is recorded. A control that is not there stops it, and says at
   which step and why; the steps from there keep their role and name.
4. **Writes the script** into the work folder's `scripts` folder (never over an existing file), with
   `<name>.recording-notes.txt` beside it.

The narration is plain wording of each step ("In the Subject list, choose Science."). A person makes it better before the
video is made, by hand or with the AI.

## What is left out, and said in the notes

- A click on something without a name (a blank part of the window), a right or middle click.
- Anything done while another program was in front, which also keeps notifications and other windows out of the video.
- Typing the recording did not keep: the recorder leaves out keys in password fields, keys it could not be sure were
  aimed at a text field, and every key when the author chose to leave keys out. The notes say to fill in what each box
  should say.
- Keys Studio cannot press.
- Which demo project the video starts in: the program's first, unless one is chosen. A recording does not say.

Window titles are never copied into the script (a title can show private things). The typed words are, since they are
what the video types; the script scan checks them against the blocklist before anything is recorded, as for any script.

## Which programs

Only programs Studio can perform (`src/pipeline/programs.ts`), found by the window the take was made in. A recording of
any other program is refused with the list of programs Studio knows. When every control is found, the script uses the
demo hook (pixel-identical videos). When one is not, and the program can also be started without its hook, the draft is
written for the accessibility driver, which finds controls by role and name.

## The example

`examples/recordings/plan-a-lesson.capture` is an invented recording of Practice Planner, written by hand in the capture
format: a new lesson, a title typed with a slip corrected by Backspace, two drop-down choices, notes, a click on a blank
part of the page, a notification from another program, the Lesson settings dialog, Ctrl+S, three markers, and a last log
line cut short as a crash leaves it. `tests/recording.test.ts` checks the rules against it, and the helper's test reads it
with the core's reader.

## What waits on the core

The "send to" path (a recorder handing a recording straight to Studio) and an automation id in the log's `element` line:
`CORE-REQUESTS.md`, S3 and S4.
