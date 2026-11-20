# The tutorial script format (version 3)

A tutorial script is one JSON file that fully describes one video. A person or any AI model can write one, and the player
performs it without interpretation. `src/script/format.ts` holds the types and `src/script/validate.ts` the validator,
which rejects a malformed script before the player runs it. `examples/plan-a-lesson.json` is a complete example.

## The header

| Field | Required | What it holds |
|---|---|---|
| `format` | yes | Always `"openstage-studio-script"`. |
| `version` | yes | `3`. A version 1 or 2 script is read as version 3 (see "Versions" below). A newer number is refused with a message saying a newer Studio made it. |
| `title` | yes | The video's title, at most 100 characters (it goes on the title card). |
| `goal` | yes | One line: what the viewer can do after watching. |
| `program` | yes | `{ "id": "practice-planner", "name": "Practice Planner", "version": "1.0" }`. The id is how Studio finds the program to launch (`src/pipeline/programs.ts`); the name goes on the cards. |
| `driver` | no | `"hook"` (the default), or `"accessibility"` for a program without the hook (docs/accessibility-driver.md: targets are automation ids, steps are click, type and wait). `"position"` is part of the format but not built yet. |
| `startState` | yes | `{ "demoProject": "demo-lessons-01", "note": "..." }`. Always a demo project by name, never a file path. |
| `playlist` | no | `{ "name": "...", "position": 1 }`. |
| `intro` | no | Narration spoken over the title card. |
| `outro` | no | Narration spoken over the end card. |
| `writtenBy` | no | `{ "kind": "person" or "model", "name": "...", "editedByPerson": true }`, for the guard report. |
| `publish` | no | For the publishing package: `{ "description": "...", "tags": ["..."], "thumbnailStep": 3 }`. The description opens the video's description (the goal is used if there is none); the thumbnail shows that step's picture (the last step's if left out). |
| `redactions` | no | Blurred boxes, usually added by the review screen: `[{ "box": [697, 401, 566, 38], "fromStep": 1, "toStep": 2, "reason": "..." }]`. The box is left, top, width and height in pixels of the 1920 by 1080 video; it blurs every picture of the take from the start of `fromStep` (0 is the starting picture) to the start of the step after `toStep`. Title and end cards are never blurred. |
| `steps` | yes | 1 to 200 steps. |

## A step

| Field | What it holds | Example |
|---|---|---|
| `action` | What the player does | `click`, `type`, `key`, `scroll`, `open`, `wait` (`drag` is refused for now) |
| `target` | The control, by its stable name | `toolbar.lesson.new` |
| `fallback` | Another way to find it: with the accessibility driver, a control with no automation id is found by `role` and `name` (and the step needs no target) | `{ "role": "button", "name": "New lesson" }` or `{ "x": 0.2, "y": 0.05 }` |
| `value` | Text to type, a key, a demo project, a scroll, or seconds to wait | `Sorting leaves by shape`, `Ctrl+S`, `down 400` |
| `words` | For a click: words inside the control to click on (the hook, version 5). They are selected, so a key or typing that follows works on them | `Akafer` |
| `caret` | With `words`: `before` or `after` puts the cursor just before or after the words instead of selecting them | `after` |
| `narration` | One or two sentences spoken over the step | `Select New lesson on the toolbar.` |
| `silent` | `true` for a step with no narration on purpose | |
| `callout` | A box, arrow or label drawn on the frame | `{ "type": "box", "around": "toolbar.lesson.new" }` |
| `highlight` | Whether the yellow click circle shows (default on) | `false` |
| `hold` | Extra pause after the narration, 0 to 10 seconds | `0.5` |
| `expect` | What must be true afterward, for rehearsal | `A new untitled lesson is selected` |
| `chapter` | Starts a chapter of the video here | `Share and save` |
| `describe` | For a viewer who cannot see the screen: what the step shows that the narration does not say, at most 280 characters (version 3). It goes into the video's description track and the transcript | `The new lesson appears at the bottom of the list, highlighted.` |

### Actions

- `click`: needs a `target`. The pointer travels to it, the program's hover look shows, then the click. With `words`, the
  pointer goes to those words inside the control (the first place they appear) and the click selects them, as a
  double-click on a word or a drag across several would; then `type` with no target replaces them, and Backspace removes
  them. With `caret` (`before` or `after`) the click puts the cursor just before or after the words and selects nothing,
  for a key that inserts at the cursor. This works on a page's text and in editable areas (such as a transcript's
  turn), not inside a text box.
- `type`: needs a `value`. With a `target`, the pointer clicks into the field first; without one, it types into whatever
  has the focus. A drop-down list is chosen by typing the option's words (`"30 minutes"`).
- `key`: a key or chord: letters, digits, F1 to F12, Enter, Escape, Tab, Backspace, Delete, Space, Home, End, PageUp,
  PageDown and the arrows, with Ctrl, Alt or Shift joined by `+`. A badge with the keys shows at the bottom of the video.
- `scroll`: `up`, `down`, `left` or `right` and a distance in page pixels (`down 400`, the default `down 300`). With a
  `target`, that control scrolls; otherwise the page.
- `open`: `value` is a demo project to open.
- `wait`: `value` is seconds (up to 30; default 1). With a `target`, the take first waits until that control is on screen,
  for at most a minute, as when a program finishes work of its own (Prism Transcribe's Edit button appears when a
  transcription is done). Only the picture taken afterward is used, so the real wait never shows in the video.

### Callouts

- `{ "type": "box", "around": "<control>" }`: a red box around a control.
- `{ "type": "arrow", "to": "<control>", "from": "below" }`: an arrow pointing at a control from a side.
- `{ "type": "label", "text": "Your new lesson", "near": "<control>", "side": "right" }`: a short label, at most 60 characters.

Any callout may have a `color` (`#E0182D`). Callouts show from the moment of the action to the end of the step.

## Rules the validator enforces

- Every step has narration or is marked silent on purpose, never both.
- The starting state and `open` steps name a demo project, never a file path.
- Unknown fields are errors, so a misspelled field is caught rather than ignored.
- Control names are stable names (letters, digits, `-` and `_`, in parts joined by dots). When the program's control list
  is given (`validateScript(script, { controls })`), any target not in it is an error.
- `expect` is optional, but a script counts as rehearsed only when every step has one.
- A blurred box stays inside the 1920 by 1080 picture, and its steps are steps of the script.
- A step's `describe` is at most 280 characters.
- Warnings (not errors): narration of more than two sentences, or longer than 280 characters; a description or tags
  longer than video sites usually allow.

The script scan (docs/guard.md) runs when a video is made, not here: it checks the words a viewer will see or hear
(the title, goal, intro, outro, narration, typed values, callout labels, chapter names, a step's `describe`, the description and tags) against
the blocklist. Notes for people (`startState.note`, `expect`, `writtenBy`, a blurred box's `reason`) are not checked.

## Project settings

A `studio-project.json` beside the scripts holds what every video of a project shares:

```json
{
  "voice": { "engine": "windows", "voice": "default", "rate": 1.0 },
  "pronunciations": { "OpenStage": "Open Stage" },
  "paces": { "stepGapMs": 450 }
}
```

`pronunciations` change only what the voice is given; captions and the transcript keep the written words. `paces` can
override any of the defaults in `src/timeline/build.ts`.

`publish` (optional) sets the product's thumbnail template and the description's narration line:

```json
"publish": {
  "thumbnail": { "background": "#102037", "accent": "#FF7BCC", "color": "#FFFFFF", "kicker": "Practice Planner", "footer": "" },
  "disclosureLine": false,
  "disclosureText": "The narration in this video is computer generated."
}
```

The thumbnail's colours get a contrast check, as a warning only. The narration line is off unless a project turns it on;
every package's upload.txt says how the narration was made either way.

## Versions

Every change to the format bumps its version, and `src/script/migrate.ts` brings older scripts up to date, so no script is
ever stranded. A script brought up to date is used as it is, with a warning that says what changed; nothing is written
back unless the review screen adds a blurred box, which also writes the new version number.

| Version | What changed |
|---|---|
| 1 | The first format (phase 1). |
| 2 | Added `publish` and `redactions` (phase 2). Nothing in a version 1 script changes meaning. |
| 3 | Added a step's `describe`, for the description track (2026-11-15). Nothing in a version 2 script changes meaning. |

## The description track

Every video gets `descriptions.vtt` beside its captions: a WebVTT file for a player's descriptions track
(`kind="descriptions"`), for viewers who cannot see the screen. It is made from the script and the timeline by fixed rules
(`src/captions/descriptions.ts`): the title card's words, then for each step the words typed (when the narration does not
say them), the keys pressed, a callout label's words, and the step's `describe`, timed from the step's action to its end;
then the end card's words. The transcript has each `describe` too. The description is text only for now: speaking it waits
for the OpenStage shared core's speech engine (C5; `CORE-REQUESTS.md`, S1).
