// Rehearsal: the player performs a script in the program, in its demo workspace, with nothing recorded. A step is
// flagged if it cannot be performed, or if it would plainly do something other than meant: typing into a one-line box
// that already holds words, which adds to them (the usual mistake when a script means to replace a title, or to fill a
// new item but names an old one). With an AI chosen, the repair role proposes a fix for a flagged step, Studio checks
// it, and the script is tried again from the start, up to a set number of repairs.
//
// This is the only stage where an AI is shown the screen, and only the demo workspace: the controls and text the
// program reports, and, for a service that can see, a picture of the program's window.

import type { Answerer } from "./ask.ts";
import { repairWithPicture } from "./roles.ts";
import type { ControlFact, ProgramSession } from "../pipeline/program-session.ts";
import { play, StepFailed } from "../pipeline/player.ts";
import { parseKey, type Script, type Step } from "../script/format.ts";
import type { ControlInfo, TextOnScreen } from "../../demo-hook/protocol.ts";

export interface RepairRecord {
  /** The flagged step, counting from 1. */
  step: number;
  error: string;
  why?: string;
  /** The steps the repair replaced, counting from 1. */
  replaced?: [number, number];
  /** Why no repair was made, if none was. */
  unrepaired?: string;
}

export interface Rehearsal {
  passed: boolean;
  script: Script;
  repairs: RepairRecord[];
  /** How many times the script was performed. */
  runs: number;
}

export interface RehearseOptions {
  answerer?: Answerer;
  maxRepairs?: number;
  allControls: ControlFact[];
  /** The check every repaired script must pass. */
  check: (s: Script) => string[];
  /** The check the script as given must pass before it is performed (the same as `check` if left out). The release
   * check uses the format alone here, so a control a new version lost fails at its own step, which can then be named. */
  firstCheck?: (s: Script) => string[];
  /** A picture of the program's window now, as PNG, for a service that can see. */
  picture?: () => Promise<Buffer | null>;
  frame: [number, number];
  log?: (s: string) => void;
}

const selectsAll = (s: Step | undefined) => s?.action === "key" && parseKey(s.value ?? "")?.key === "A" && !!parseKey(s.value ?? "")?.modifiers.includes("Ctrl");

/** Why typing in this step would add to words already in a one-line box, or null if it would not. `box` is the box the
 * step types into, as the hook reports it just before the step. */
export function typingProblem(step: Step, previous: Step | undefined, box: ControlInfo | undefined): string | null {
  if (step.action !== "type" || !box || box.role !== "textbox" || box.multiline || !box.value) return null;
  // Selecting the box's words first (Ctrl+A on it, or on whatever has the focus) means the typing replaces them.
  if (selectsAll(previous) && (!previous!.target || previous!.target === box.id)) return null;
  return `The box "${box.label || box.id}" (${box.id}) already says "${box.value}", so typing "${step.value}" would add to the end of it. To replace its words, first press Ctrl+A on it ({"action": "key", "target": "${box.id}", "value": "Ctrl+A"}) and then type without a target; to fill a new box, type into the new box instead.`;
}

export async function rehearse(session: ProgramSession, start: Script, o: RehearseOptions): Promise<Rehearsal> {
  const log = o.log ?? (() => undefined);
  const canRead = session.hello.hookVersion >= 2;
  const canCheckBoxes = session.hello.hookVersion >= 3;
  let script = start;
  const repairs: RepairRecord[] = [];
  let runs = 0;
  const end = (passed: boolean): Rehearsal => ({ passed, script, repairs, runs });
  for (;;) {
    const problems = (runs === 0 && o.firstCheck ? o.firstCheck : o.check)(script);
    if (problems.length) {
      repairs.push({ step: 0, error: `The script does not pass the check: ${problems.join(" ")}`, unrepaired: "It must be fixed by hand." });
      return end(false);
    }
    runs++;
    let n = 0;
    const steps = script.steps;
    try {
      await play(script, session.hook, { grab: async () => `rehearsal-${n++}` }, {
        frame: o.frame, readText: false, afterSettleMs: 0, ...(session.outside ? { outside: session.outside } : {}),
        ...(canCheckBoxes ? {
          beforeStep: async (i: number) => {
            const step = steps[i];
            // A box in another program's window is not one of the program's controls.
            if (step.action !== "type" || step.window !== undefined) return;
            const listed = await session.hook.send<{ controls: ControlInfo[] }>({ cmd: "list" });
            const box = step.target ? listed.controls.find((c) => c.id === step.target) : listed.controls.find((c) => c.focused);
            const problem = typingProblem(step, steps[i - 1], box);
            if (problem) throw new Error(problem);
          },
        } : {}),
      });
      return end(true);
    } catch (e) {
      if (!(e instanceof StepFailed)) throw e;
      const record: RepairRecord = { step: e.step + 1, error: e.message.replace(/^Step \d+: /, "") };
      repairs.push(record);
      log(`  Step ${record.step} was flagged: ${record.error}`);
      if (!o.answerer) {
        record.unrepaired = "No AI is chosen to repair it.";
        return end(false);
      }
      if (repairs.filter((r) => r.why !== undefined).length >= (o.maxRepairs ?? 3)) {
        record.unrepaired = `It still went wrong after ${o.maxRepairs ?? 3} repairs.`;
        return end(false);
      }
      // What the screen shows now: the controls and the text, from the program itself.
      const listed = await session.hook.send<{ controls: ControlInfo[] }>({ cmd: "list" });
      const controlsNow = listed.controls.map((c) => ({ id: c.id, label: c.label, role: c.role, shownAtStart: c.visible }));
      let textNow: string[] = [];
      if (canRead) textNow = [...new Set((await session.hook.send<{ items: TextOnScreen[] }>({ cmd: "text" })).items.map((x) => x.text))];
      const picture = o.answerer.pictures && o.picture ? await o.picture() : null;
      try {
        const fixed = await repairWithPicture(o.answerer, {
          program: session.program, script, failed: e.step, error: record.error, controlsNow, textNow, allControls: o.allControls,
          ...(picture ? { picture } : {}), check: o.check,
        });
        record.why = fixed.why || "(no reason given)";
        record.replaced = [fixed.from, fixed.to];
        log(`  Repaired: ${record.why}`);
        script = fixed.script;
      } catch (err) {
        record.unrepaired = err instanceof Error ? err.message : String(err);
        return end(false);
      }
    }
  }
}
