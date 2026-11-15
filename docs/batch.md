# Batch runs and the release check (phase 4)

Phase 4 records a whole manual with nobody watching, and after a new version of a program, finds exactly which steps of
which scripts no longer work. The code is in `src/batch/`.

## The queue

`Run Queue.bat` records everything in its queue, unattended:

- **Drag a manual onto it** (a documentation project file or a PDF): every chapter with tasks is planned, written and
  rehearsed as in phase 3 (`docs/ai.md`), into `series\<program>-<chapter>\`, and then recorded. A chapter of a
  documentation project with no numbered steps is left out without asking the AI.
- **Drag series folders, folders of scripts or scripts onto it** to record those.
- **Run it as it is** to record every series under `series\`.

Before recording, each script is rehearsed against the program as it is now. A script that passes is recorded; one that
breaks is skipped, and the report names its first broken step. **A script that already exists is never changed:** with
an AI chosen, a repaired copy that passed rehearsal is saved beside it as `<name>.repaired.json` for a person to read,
and is never recorded. To use it, read it, then replace the script with it.

It carries on where it stopped: `renders\queue-state.json` remembers which videos were made from which version of each
script (by fingerprint), and a video already made from the very same script is not made again. The computer and its
screen are kept awake while it runs (`studio-helper awake`), and takes use the screen `local-settings.json` names.

Videos are made into `renders\<series>-<script>\`, each with its own review. **Every video still waits for a person to
review and approve it before it can be exported** (`docs/guard.md`); `renders\queue-report.txt` lists what was recorded,
what broke and why, and what to do next.

Decided with Jason on 2026-11-15: the queue records every script that passes rehearsal, including AI-written scripts a
person has not read yet (the review gate before export is the person's check); it is started by hand (double-click),
not scheduled; and the AI proposes repairs but they are never recorded.

## The release check

`Release Check.bat` rehearses every script (every series and everything under `examples\`, or the folders and scripts
dragged onto it) against the programs as they are installed now. Nothing is recorded and no script is changed. For each
script it reports either that it still works, or the first step that can no longer be performed: its number, what it
does, its narration and why it failed. With an AI chosen, a broken script also gets a repaired copy beside it, as above.

The script as written is only checked against the format before it is performed (not against the program's controls),
so a control a new version lost fails at its own step, which is the step the report names. A script stops at its first
broken step, because later steps depend on it; once that step is fixed, the next check finds any later one.

The report is in `renders\release-check\report.txt`.

## The acceptance test

`Check Batch.bat` runs the spec's test for phase 4, with the AI `Set Up AI.bat` chose, in its own folder
(`renders\batch-check\`) so nothing else is touched:

1. The invented Practice Planner manual (`examples/manuals/`) records unattended: every planned video must be made.
2. Practice Planner version 2 (`sample-program/versions.ts`, started with `--sample-version 2`, or by setting
   `PRACTICE_PLANNER_VERSION=2` for Studio) renames two controls, as a new release might. The release check, run on the
   new videos' scripts and on `examples/plan-a-lesson.json`, must name exactly the steps those changes break. The
   expected steps are worked out from the scripts and the list of changes, not from the report.
