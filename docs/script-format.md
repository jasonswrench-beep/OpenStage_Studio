# The tutorial script format (version 1)

A tutorial script is one JSON file that fully describes one video. A person or any AI model can write one, and the player
performs it without interpretation. `src/script/format.ts` holds the types and `src/script/validate.ts` the validator,
which rejects a malformed script before the player runs it. `examples/plan-a-lesson.json` is a complete example.

## The header

| Field | Required | What it holds |
|---|---|---|
| `format` | yes | Always `"openstage-studio-script"`. |
| `version` | yes | `1`. A newer number is refused with a message saying a newer Studio made it. |
| `title` | yes | The video's title, at most 100 characters (it goes on the title card). |
| `goal` | yes | One line: what the viewer can do after watching. |
| `program` | yes | `{ "id": "practice-planner", "name": "Practice Planner", "version": "1.0" }`. The id is how Studio finds the program to launch (`src/pipeline/programs.ts`); the name goes on the cards. |
| `driver` | no | `"hook"` (the default). `"accessibility"` and `"position"` are part of the format but not built yet. |
| `startState` | yes | `{ "demoProject": "demo-lessons-01", "note": "..." }`. Always a demo project by name, never a file path. |
| `playlist` | no | `{ "name": "...", "position": 1 }`. |
| `intro` | no | Narration spoken over the title card. |
| `outro` | no | Narration spoken over the end card. |
| `writtenBy` | no | `{ "kind": "person" or "model", "name": "...", "editedByPerson": true }`, for the guard report. |
| `steps` | yes | 1 to 200 steps. |

## A step

| Field | What it holds | Example |
|---|---|---|
| `action` | What the player does | `click`, `type`, `key`, `scroll`, `open`, `wait` (`drag` is refused for now) |
| `target` | The control, by its stable name | `toolbar.lesson.new` |
| `fallback` | A second way to find it, for later drivers | `{ "role": "button", "name": "New lesson" }` or `{ "x": 0.2, "y": 0.05 }` |
| `value` | Text to type, a key, a demo project, a scroll, or seconds to wait | `Sorting leaves by shape`, `Ctrl+S`, `down 400` |
| `narration` | One or two sentences spoken over the step | `Select New lesson on the toolbar.` |
| `silent` | `true` for a step with no narration on purpose | |
| `callout` | A box, arrow or label drawn on the frame | `{ "type": "box", "around": "toolbar.lesson.new" }` |
| `highlight` | Whether the yellow click circle shows (default on) | `false` |
| `hold` | Extra pause after the narration, 0 to 10 seconds | `0.5` |
| `expect` | What must be true afterward, for rehearsal | `A new untitled lesson is selected` |
| `chapter` | Starts a chapter of the video here | `Share and save` |

### Actions

- `click`: needs a `target`. The pointer travels to it, the program's hover look shows, then the click.
- `type`: needs a `value`. With a `target`, the pointer clicks into the field first; without one, it types into whatever
  has the focus. A drop-down list is chosen by typing the option's words (`"30 minutes"`).
- `key`: a key or chord: letters, digits, F1 to F12, Enter, Escape, Tab, Backspace, Delete, Space, Home, End, PageUp,
  PageDown and the arrows, with Ctrl, Alt or Shift joined by `+`. A badge with the keys shows at the bottom of the video.
- `scroll`: `up`, `down`, `left` or `right` and a distance in page pixels (`down 400`, the default `down 300`). With a
  `target`, that control scrolls; otherwise the page.
- `open`: `value` is a demo project to open.
- `wait`: `value` is seconds (up to 30; default 1).

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
- Warnings (not errors): narration of more than two sentences, or longer than 280 characters.

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
