# AI planning, scripting and rehearsal (phase 3)

AI is optional in Studio. It plans videos from a manual, writes their tutorial scripts, repairs scripts that fail in
rehearsal, and writes their publishing details. It never performs a recorded take and never approves a video, and every
thing it makes is a plain file a person can read and edit before anything is recorded. With no AI, a person writes the
same files by hand (`docs/script-format.md`).

The code is in `src/ai/` and `src/manual/`.

## Choosing the AI

`Set Up AI.bat` asks which AI to use, then tries it with one small question. The choice is kept on this computer only, in
`%APPDATA%\org.openstage.studio\ai.json`, never in a project or the repository.

| Choice | What it is |
|---|---|
| The built-in model | Qwen 3.5 with 4 billion parameters, run on this computer by llama.cpp's server. Downloaded once on request (2.8 GB), every file checked against `tools/local-ai.json`: the same pinned files the documentation tool uses. Nothing leaves the computer. It reads text only. |
| Claude (Anthropic) | Your own key. Uses Anthropic's own library (`@anthropic-ai/sdk`); the model starts as `claude-opus-5-5`, and a refusal falls back on the service's own fallback model. Can be shown pictures. |
| ChatGPT (OpenAI) | Your own key and the model's name. Uses the service's chat-completions request. Can be shown pictures. |
| Gemini (Google) | Your own key and the model's name, through the service's chat-completions address. Can be shown pictures. |
| Another service | Any service that accepts the chat-completions request: its address, the model's name and, if it needs one, a key. |
| No AI | Every stage by hand. |

With a hosted service, the manual's text, the scripts and pictures of the demo workspace are sent to that service; Setup
says so before you choose. Studio never sends a picture from outside the demo workspace, and never sends a key anywhere
but its own service. The built-in model's server listens on this computer only, with a one-time password, and is
stopped when Studio is done with it.

## The stages

| Stage | Double-click | What it makes |
|---|---|---|
| Import | (part of Plan) | Reads a documentation project file (`.openexplainer`, the preferred import: each step and what was clicked are already there) or a PDF (its words, chapter by chapter from its bookmarks). |
| Plan | `Plan Videos.bat` (drag a manual onto it) | `series\<program>-<chapter>\plan.json`: one video per task, in teaching order, each with a title, a goal, the topics it covers and a status. |
| Approve | (by hand) | In `plan.json`, set each video's `status` to `approved` or `cut`; reword, merge or split videos as you like. |
| Script | `Write Scripts.bat` (drag the series folder onto it) | A tutorial script for each approved video, `01-<video>.json` and on. |
| Rehearse | `Rehearse Scripts.bat` (drag the series folder onto it) | Each script is performed in the program with nothing recorded; failures are repaired and tried again. `rehearsal.txt` says what happened. |
| Record | `Make Video.bat` (drag a script onto it) | The video, as in phases 1 and 2, with the guard and the review. |

### What each AI role is given

| Role | Given | Makes | Sees the screen |
|---|---|---|---|
| Planner | The chapter's words and steps | The video list | No |
| Scriptwriter | One planned video, the manual's words for it, the program's real control list, its demo projects and notes | A tutorial script | No |
| Rehearsal repair | The script, the failed step and why, the controls and text on screen at that moment, and (for a service that can see) a picture of the program's window | Replacement steps | The demo workspace only |
| Metadata writer | The rehearsed script | The description, tags and chapter names, in the script | No |

### The checks every AI answer must pass

Studio checks every answer and, if it fails, asks again with the problems in words (up to three or four times):

- a script must pass the format check (`src/script/validate.ts`);
- every control it names must be one the program really has: the list is read from the program itself through its
  demo-mode hook, with each demo project open, plus the numbered families a program declares (such as
  `sidebar.lesson.*`, `src/pipeline/programs.ts`);
- it may start only from one of the program's demo projects, and open only those;
- it must pass the script scan (no blocked names, `docs/guard.md`).

A script records which AI wrote it (`writtenBy`, with `editedByPerson: false`); a person who edits it should set that to
`true`, for the guard report.

### Rehearsal and repair

The player performs the script exactly as in a take, through the hook, but saves no pictures. A step is flagged if:

- it cannot be performed (a control not on screen, switched off, a choice that is not in a list); or
- it types into a one-line box that already holds words, without selecting them first with Ctrl+A. Typing adds to a
  box's words, so this is how a script that means to change a title, or to fill a new item, ends up adding to an old one.
  Several-line boxes (notes) are not flagged: adding to them is normal.

For a flagged step, the repair role is asked for steps to replace a run of steps ending with that one; Studio checks them
and performs the script again from the start. A script gets up to three repairs. Passing rehearsal means every step can
be performed and none types onto old words; whether each step's `expect` is true is still for a person to judge when
watching.

Two other checks run before rehearsal, when the script is written: clicking a drop-down list to choose from it is refused
(a click only opens it; a choice is made by typing its words), and so is any control the program does not have.

Asking the AI itself to judge each step's `expect` against what changed on screen was tried (2026-11-15) and dropped: the
built-in model flagged ordinary changes as wrong, and its repairs then made sound scripts worse. The fixed rules above
catch the mistakes it found, without that noise.

## The acceptance test

`Check AI Scripts.bat` runs the spec's test for phase 3 with the AI `Set Up AI.bat` chose: from the "Planning lessons"
chapter of `examples/manuals/Practice Planner Guide.openexplainer` (an invented manual for the invented practice program,
made by `tools/make-practice-manual.ts`), the AI plans the videos and writes every script, and at least four in five must
pass rehearsal after automatic repair, with no hand edits.

## For a new program

A program needs, in `src/pipeline/programs.ts`: its demo projects with a line on what each holds (`demos`), its numbered
controls that appear only after an action (`appearing`), and any notes a scriptwriter needs (`notes`).
