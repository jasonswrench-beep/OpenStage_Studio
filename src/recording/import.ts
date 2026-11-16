// Script From Recording.bat: a recording made by an OpenStage recorder (the shared capture format, C1) becomes a draft
// tutorial script that Studio performs again, in the real program, to make a repeatable video.
//
//   1. The helper reads the recording with the shared core's own reader (studio-helper recording).
//   2. Fixed rules turn one take's clicks and typing into steps (src/recording/to-script.ts).
//   3. Studio opens the program through its demo-mode hook, on the take screen, and performs the steps, finding each
//      control by the role and name the recording holds and writing in its stable id. This is a rehearsal: nothing is
//      recorded. A step whose control is not there stops it, and says so.
//   4. The script goes into the work folder's `scripts` folder, with a notes file saying what was left out and why.
//
// A person reads the script (and makes the narration better, by hand or with the AI) before the video is made.
//
// node src/recording/import.ts <something.capture> [--take <n>] [--demo <demo project>] [--title <words>] [--goal <words>]

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { helperPath, runHelper } from "../pipeline/helper.ts";
import { openProgram, type ProgramSession } from "../pipeline/program-session.ts";
import { play, StepFailed } from "../pipeline/player.ts";
import { PROGRAMS } from "../pipeline/programs.ts";
import { FRAME, takeMonitor } from "../pipeline/make-video.ts";
import { slug } from "../ai/roles.ts";
import { validateScript, describeProblems } from "../script/validate.ts";
import type { Script } from "../script/format.ts";
import type { ControlInfo } from "../../demo-hook/protocol.ts";
import { appRoot, workspace } from "../paths.ts";
import { isMain } from "../util/is-main.ts";
import { recordingToScript, type Draft, type DraftOptions, type Recording } from "./to-script.ts";

/** A recording, as the shared core's reader gives it. */
export async function readRecording(project: string): Promise<Recording> {
  const events = await runHelper(helperPath(), ["recording", "--project", resolve(project)]);
  const r = events.find((e) => e.event === "recording");
  if (!r) throw new Error(`${project} could not be read as a recording.`);
  return r as unknown as Recording;
}

const sameName = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** The control on screen now with this role and name: the visible, usable one if there are several. */
export function findControl(controls: ControlInfo[], role: string | undefined, name: string): ControlInfo | undefined {
  const named = controls.filter((c) => sameName(c.label, name) && (!role || c.role === role));
  return named.find((c) => c.visible && c.enabled) ?? named.find((c) => c.visible) ?? named[0];
}

/**
 * Perform the draft in the program through its hook, giving every step its control's stable id as it goes. Returns the
 * script with ids (and no role-and-name fallbacks left), or, if a step's control could not be found, null and the
 * reason. Nothing is recorded.
 */
export async function resolveTargets(session: ProgramSession, draft: Script, log: (s: string) => void): Promise<{ script: Script | null; why?: string; step?: number }> {
  const script: Script = JSON.parse(JSON.stringify(draft));
  try {
    await play(script, session.hook, { grab: async () => "rehearsal" }, {
      frame: FRAME, readText: false, log,
      beforeStep: async (i: number) => {
        const step = script.steps[i];
        if (step.target || !step.fallback?.name) return;
        const listed = await session.hook.send<{ controls: ControlInfo[] }>({ cmd: "list" });
        const found = findControl(listed.controls, step.fallback.role, step.fallback.name);
        if (!found) throw new Error(`There is no ${step.fallback.role ?? "control"} called "${step.fallback.name}" on screen in ${session.program.name} at this point.`);
        step.target = found.id;
        delete step.fallback;
      },
    });
    return { script };
  } catch (e) {
    if (e instanceof StepFailed) return { script: null, why: e.message, step: e.step + 1 };
    throw e;
  }
}

export interface Imported {
  file: string;
  notesFile: string;
  draft: Draft;
  /** Whether every control was found in the program, so the script uses stable ids. */
  resolved: boolean;
  problems: string[];
}

/** A file name in `folder` that is not taken yet: a script that exists is never written over. */
function freeName(folder: string, base: string): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}.json` : `${base}-${n}.json`;
    if (!existsSync(join(folder, name))) return join(folder, name);
  }
}

export async function importRecording(project: string, o: DraftOptions & { monitor?: number; log?: (s: string) => void; outFolder?: string; resolveInProgram?: boolean } = {}): Promise<Imported> {
  const log = o.log ?? console.log;
  log(`Reading the recording ${basename(resolve(project))}.`);
  const recording = await readRecording(project);
  const draft = recordingToScript(recording, PROGRAMS, o);
  log(`Take ${draft.take} in ${draft.program.name}: ${draft.script.steps.length} steps.`);
  let script = draft.script;
  let resolved = false;
  if (o.resolveInProgram !== false) {
    log(`Finding each control in ${draft.program.name} (on the take screen; nothing is recorded).`);
    const session = await openProgram(appRoot(), draft.program.id, takeMonitor(o.monitor), log, "hook");
    try {
      const r = await resolveTargets(session, script, log);
      if (r.script) {
        script = r.script;
        resolved = true;
        log("Every control was found; the script names each by its stable id.");
      } else {
        draft.notes.unshift(`Step ${r.step} could not be performed: ${r.why} The steps from there on still find their controls by role and name; fix that step (or record that part again), then run this again or rehearse the script.`);
        log(`Stopped at step ${r.step}: ${r.why}`);
      }
    } finally {
      await session.close();
    }
  }
  // A script that still finds controls by role and name can be performed by the accessibility driver, if the program has
  // a way to start without its hook; otherwise it waits for the person to fix the step that stopped.
  const program = PROGRAMS.find((p) => p.id === draft.program.id);
  if (!resolved && program?.launchPlain) script = { ...script, driver: "accessibility" };
  const v = validateScript(script);
  const problems = v.ok ? [] : describeProblems(v);
  const folder = o.outFolder ?? join(workspace(), "scripts");
  mkdirSync(folder, { recursive: true });
  const file = freeName(folder, slug(script.title));
  writeFileSync(file, JSON.stringify(script, null, 2) + "\n");
  const notesFile = file.replace(/\.json$/, ".recording-notes.txt");
  writeFileSync(notesFile, [
    `Made from the recording ${resolve(project)}, take ${draft.take}, in ${draft.program.name}.`,
    resolved ? "Every control was found in the program; the script names each by its stable id." : "Not every control was found in the program yet (see below).",
    "", "What a person should look at:", ...draft.notes.map((n) => `- ${n}`),
    ...(problems.length ? ["", "What the format check says:", ...problems.map((p) => `- ${p}`)] : []),
    "", "The recording itself is not changed, and nothing from it leaves this computer. Its window titles are not copied into the script.",
  ].join("\n") + "\n");
  log(`The script is ${file}; what to look at is in ${notesFile}.`);
  return { file, notesFile, draft, resolved, problems };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const project = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (!project) {
    console.error("Say which recording to use: a folder whose name ends in .capture.");
    process.exit(2);
  }
  const take = value("--take");
  importRecording(project, {
    ...(take ? { take: Number(take) } : {}), demoProject: value("--demo"), title: value("--title"), goal: value("--goal"),
    monitor: value("--monitor") ? Number(value("--monitor")) : undefined,
  }).then(
    (r) => process.exit(r.resolved && !r.problems.length ? 0 : 1),
    (e) => {
      console.error(`\nNo script was made: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
