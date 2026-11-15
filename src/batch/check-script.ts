// Checking one existing script against the program as it is now, for the queue and the release check. The script is
// performed with nothing recorded and is never changed. If a step breaks and an AI is chosen, the AI's repair (tried in
// rehearsal too) is saved beside it as <name>.repaired.json for a person to read; it is never recorded.

import { writeFileSync } from "node:fs";
import type { Answerer } from "../ai/ask.ts";
import { rehearse } from "../ai/rehearse.ts";
import { checker, type ProgramFacts } from "../ai/series.ts";
import type { ProgramSession } from "../pipeline/program-session.ts";
import type { Script, Step } from "../script/format.ts";
import { validateScript } from "../script/validate.ts";

export interface ScriptCheck {
  works: boolean;
  /** The first step that broke, counting from 1, the step itself, and why. */
  broken?: { step: number; what?: Step; error: string };
  /** A repaired copy saved for a person, if one was made and passed rehearsal. */
  repairedFile?: string;
  /** Why there is no repair, if there is none. */
  unrepaired?: string;
}

/** The format check alone (a control a new version lost then fails at its own step, where it can be named). */
export const formatOnly = (s: Script) => validateScript(s).errors.map((e) => `${e.path}: ${e.message}`);

/** The steps' description in a few words: "click toolbar.settings", "type editor.title "Leaves"". */
export function stepWords(s: Step): string {
  return `${s.action}${s.target ? ` ${s.target}` : ""}${s.value ? ` "${s.value}"` : ""}`;
}

export async function checkScript(session: ProgramSession, file: string, script: Script, o: { facts: ProgramFacts | null; answerer: Answerer | null; frame: [number, number]; log?: (s: string) => void }): Promise<ScriptCheck> {
  const canRepair = !!(o.answerer && o.facts);
  const full = o.facts ? checker(session.program, o.facts.all) : formatOnly;
  const r = await rehearse(session, script, {
    ...(canRepair ? { answerer: o.answerer! } : {}),
    maxRepairs: 3,
    allControls: o.facts?.all ?? [],
    check: full,
    firstCheck: formatOnly,
    frame: o.frame,
    ...(o.log ? { log: o.log } : {}),
  });
  if (!r.repairs.length) return { works: true };
  const first = r.repairs[0];
  const broken = { step: first.step, what: script.steps[first.step - 1], error: first.error };
  if (r.passed) {
    const repairedFile = file.replace(/\.json$/i, ".repaired.json");
    const repaired: Script = { ...r.script, writtenBy: { kind: "model", name: o.answerer!.name, editedByPerson: false } };
    writeFileSync(repairedFile, JSON.stringify(repaired, null, 2) + "\n");
    return { works: false, broken, repairedFile };
  }
  const why = r.repairs[r.repairs.length - 1].unrepaired;
  return { works: false, broken, unrepaired: canRepair ? (why ?? "The repair did not pass rehearsal.") : o.answerer ? "The program lists no demo projects, so a repair cannot be checked." : "No AI is chosen to propose a repair." };
}
