// Versions of the practice program, for phase 4's release check. Version 1 is the program the examples were written
// for. Version 2 changes the interface on purpose, as a new release might: a release check must name exactly the steps
// these changes break. Start version 2 with `--sample-version 2` (Studio: set PRACTICE_PLANNER_VERSION=2).

export interface Change {
  /** The control's stable name in version 1, gone in version 2. */
  was: string;
  /** Its stable name and words in version 2. */
  now: string;
  label: string;
  /** What changed, in words. */
  about: string;
}

export const VERSION_2_CHANGES: Change[] = [
  { was: "toolbar.settings", now: "toolbar.share", label: "Share and reminders", about: "The Lesson settings button is renamed Share and reminders." },
  { was: "editor.checklist.add", now: "editor.checklist.new", label: "New item", about: "Add item, under Things to bring, is renamed New item." },
];

/** The version this copy of the program runs as: 1 unless its shell said otherwise. */
export function programVersion(global: Record<string, unknown>): number {
  const v = Number(global.__PRACTICE_PLANNER_VERSION__);
  return Number.isInteger(v) && v >= 1 ? v : 1;
}
