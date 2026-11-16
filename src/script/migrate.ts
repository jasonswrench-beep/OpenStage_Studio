// Brings a script written for an older version of the format up to the current one. Every format change bumps
// SCRIPT_VERSION and adds a step here (CLAUDE.md, "Architecture"), so no script is ever stranded.

import { SCRIPT_VERSION } from "./format.ts";

type Obj = Record<string, unknown>;

/** What each version added, said in words for the person whose script was brought up to date. */
const STEPS: Record<number, { says: string; run: (s: Obj) => Obj }> = {
  // Version 2 added the optional `publish` block and `redactions`. Nothing in a version 1 script changes meaning.
  1: { says: "Version 2 added the publishing details and blurred boxes; nothing in this script changed.", run: (s) => ({ ...s, version: 2 }) },
  // Version 3 added a step's optional `describe`, for the description track. Nothing in a version 2 script changes meaning.
  2: { says: "Version 3 added descriptions for viewers who cannot see the screen; nothing in this script changed.", run: (s) => ({ ...s, version: 3 }) },
};

export interface Migrated {
  data: unknown;
  /** The version the script was written in, when it was not the current one. */
  from?: number;
  notes: string[];
}

/** The script brought up to the current version, if it is an older one. Anything else is returned as it was, for the
 * validator to report on. */
export function migrateScript(input: unknown): Migrated {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { data: input, notes: [] };
  let s = input as Obj;
  const from = s.version;
  if (typeof from !== "number" || !Number.isInteger(from) || from >= SCRIPT_VERSION || from < 1) return { data: input, notes: [] };
  const notes: string[] = [];
  for (let v = from; v < SCRIPT_VERSION; v++) {
    const step = STEPS[v];
    if (!step) return { data: input, notes: [] };
    s = step.run(s);
    notes.push(step.says);
  }
  return { data: s, from, notes };
}
