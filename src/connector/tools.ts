// The connector's tools: what an outside assistant may do through OpenStage Studio. It can read a manual and a program's
// real controls, write tutorial scripts into the connector's folder, and rehearse them in the program (on the take screen,
// with nothing recorded). Every tool checks everything first, so a call that cannot be done says why and changes nothing.
// It never records, approves or exports a video.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { rehearse } from "../ai/rehearse.ts";
import { checker, programFacts, type ProgramFacts } from "../ai/series.ts";
import { formatOnly, stepWords } from "../batch/check-script.ts";
import { importManual } from "../manual/import.ts";
import { chapterText, findChapter } from "../manual/manual.ts";
import { FRAME, takeMonitor } from "../pipeline/make-video.ts";
import { openProgram } from "../pipeline/program-session.ts";
import { findProgram, PROGRAMS } from "../pipeline/programs.ts";
import { SCRIPT_FORMAT, type Driver, type Script } from "../script/format.ts";
import { validateScript } from "../script/validate.ts";
import type { ControlInfo, TextOnScreen } from "../../demo-hook/protocol.ts";
import { fileIn } from "./settings.ts";
import { workspace } from "../paths.ts";

/** Where a person's work is: the project folder in the repository, or the workspace when installed (src/paths.ts). */
const ROOT = workspace();

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: Context): Promise<string>;
}

export interface Context {
  folder: string;
  /** The assistant's name, from its first message, for a script's writtenBy. */
  client: string;
  log: (s: string) => void;
  /** Controls already read, by program and driver, so a program is not opened again for each script. */
  facts: Map<string, ProgramFacts>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });

const driversOf = (id: string): Driver[] => (findProgram(id).launchPlain ? ["hook", "accessibility"] : ["hook"]);

function driverArg(program: string, v: unknown): Driver {
  const d = (v ?? "hook") as Driver;
  if (!driversOf(program).includes(d)) throw new Error(`${findProgram(program).name} can be driven by: ${driversOf(program).join(", ")}.`);
  return d;
}

async function factsFor(ctx: Context, program: string, driver: Driver): Promise<ProgramFacts> {
  const key = `${program}|${driver}`;
  if (!ctx.facts.has(key)) {
    const session = await openProgram(ROOT, program, takeMonitor(), ctx.log, driver);
    try {
      ctx.facts.set(key, await programFacts(session));
    } finally {
      await session.close();
    }
  }
  return ctx.facts.get(key)!;
}

/** Everything wrong with a script for its program, in words: the format, the program's real controls and demo projects,
 * and the script scan. */
async function problemsOf(ctx: Context, data: unknown): Promise<{ problems: string[]; script?: Script }> {
  const v = validateScript(data);
  if (!v.ok) return { problems: v.errors.map((e) => `${e.path}: ${e.message}`) };
  const script = v.script!;
  try {
    findProgram(script.program.id);
  } catch (e) {
    return { problems: [`program.id: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const driver = script.driver ?? "hook";
  if (!driversOf(script.program.id).includes(driver)) return { problems: [`driver: ${findProgram(script.program.id).name} cannot be driven by ${driver}.`] };
  const facts = await factsFor(ctx, script.program.id, driver);
  return { problems: checker(findProgram(script.program.id), facts.all)(script), script };
}

export const TOOLS: Tool[] = [
  {
    name: "list_programs",
    description: "The programs Studio can drive: each one's id, the drivers it can be driven by (hook, or accessibility for no hook), its demo projects (a script must start from one), and notes for writing its scripts.",
    inputSchema: obj({}),
    async run() {
      return JSON.stringify(PROGRAMS.map((p) => ({
        id: p.id, name: p.name, drivers: driversOf(p.id), demoProjects: p.demos ?? [], numberedControls: p.appearing ?? [], notes: p.notes ?? "",
      })), null, 2);
    },
  },
  {
    name: "list_controls",
    description: "Open a program (on the take screen, nothing recorded) with a demo project and list its real controls: the stable name a script's target uses, the words on screen, the role, and whether it shows at the start. With the accessibility driver, the stable name is the control's automation id; a control with none is found by a step's fallback {role, name}.",
    inputSchema: obj({ program: str("The program's id, from list_programs."), demo_project: str("A demo project's name (the program's first if left out)."), driver: { type: "string", enum: ["hook", "accessibility"], description: "How to drive it (hook if left out)." } }, ["program"]),
    async run(a, ctx) {
      const program = findProgram(String(a.program));
      const driver = driverArg(program.id, a.driver);
      const demo = a.demo_project ? String(a.demo_project) : program.demos?.[0]?.name;
      if (!demo || !(program.demos ?? []).some((d) => d.name === demo)) throw new Error(`"${demo}" is not one of ${program.name}'s demo projects.`);
      const session = await openProgram(ROOT, program.id, takeMonitor(), ctx.log, driver);
      try {
        await session.hook.send({ cmd: "reset" });
        await session.hook.send({ cmd: "loadDemo", name: demo });
        await session.hook.send({ cmd: "settle" });
        const list = await session.hook.send<{ controls: ControlInfo[] }>({ cmd: "list" });
        return list.controls.map((c) => `${c.id || "(no id)"}: "${c.label.slice(0, 80)}" (${c.role || "control"})${c.visible ? "" : " [not shown at the start]"}`).join("\n") || "(no controls)";
      } finally {
        await session.close();
      }
    },
  },
  {
    name: "list_files",
    description: "The manuals (.openexplainer or .pdf) and tutorial scripts (.json) in the connector's folder.",
    inputSchema: obj({}),
    async run(_a, ctx) {
      const names = readdirSync(ctx.folder, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name).sort();
      const scripts = names.filter((n) => n.toLowerCase().endsWith(".json")).filter((n) => {
        try {
          return JSON.parse(readFileSync(resolve(ctx.folder, n), "utf8")).format === SCRIPT_FORMAT;
        } catch {
          return false;
        }
      });
      return JSON.stringify({ manuals: names.filter((n) => /\.(openexplainer|pdf)$/i.test(n)), scripts }, null, 2);
    },
  },
  {
    name: "read_manual",
    description: "Read a manual in the connector's folder. Without a chapter: its chapters, numbered. With one (a number or words from its title): that chapter's words and numbered steps, with what was clicked where the manual recorded it.",
    inputSchema: obj({ file: str("The manual's file name."), chapter: str("A chapter's number or words from its title.") }, ["file"]),
    async run(a, ctx) {
      const m = await importManual(fileIn(ctx.folder, String(a.file), [".openexplainer", ".pdf"]));
      if (!a.chapter) return `${m.title}${m.product ? ` (about ${m.product})` : ""}\n${m.chapters.map((c, i) => `${i + 1}. ${c.title}`).join("\n")}`;
      return chapterText(findChapter(m, String(a.chapter)));
    },
  },
  {
    name: "read_script",
    description: "Read a tutorial script in the connector's folder.",
    inputSchema: obj({ file: str("The script's file name (.json).") }, ["file"]),
    async run(a, ctx) {
      const path = fileIn(ctx.folder, String(a.file), [".json"]);
      if (!existsSync(path)) throw new Error(`There is no script called "${a.file}".`);
      return readFileSync(path, "utf8");
    },
  },
  {
    name: "check_script",
    description: "Check a tutorial script without writing it: the format (docs/script-format.md), the program's real controls and demo projects, and the scan for blocked names. Says every problem, or that it passes.",
    inputSchema: obj({ script: { type: "object", description: "The whole script, as JSON." } }, ["script"]),
    async run(a, ctx) {
      const { problems } = await problemsOf(ctx, a.script);
      return problems.length ? `It does not pass yet:\n${problems.map((p) => `- ${p}`).join("\n")}` : "It passes every check.";
    },
  },
  {
    name: "write_script",
    description: "Write a tutorial script into the connector's folder (replacing one of the same name). It is written only if it passes every check (as check_script); otherwise nothing changes and the problems are said. writtenBy is set to this assistant unless the script says otherwise.",
    inputSchema: obj({ file: str("A plain file name ending in .json."), script: { type: "object", description: "The whole script, as JSON." } }, ["file", "script"]),
    async run(a, ctx) {
      const path = fileIn(ctx.folder, String(a.file), [".json"]);
      if (/\.repaired\.json$/i.test(path)) throw new Error("A .repaired.json name is kept for repairs a person reads; choose another name.");
      const data = { ...(a.script as Record<string, unknown>) };
      if (!data.writtenBy) data.writtenBy = { kind: "model", name: ctx.client, editedByPerson: false };
      const { problems } = await problemsOf(ctx, data);
      if (problems.length) return `Not written. Problems:\n${problems.map((p) => `- ${p}`).join("\n")}`;
      writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
      return `Written: ${String(a.file)}. Rehearse it with rehearse_script.`;
    },
  },
  {
    name: "rehearse_script",
    description: "Perform a script in its program, step by step, with nothing recorded (on the take screen). Says it passed, or the first step that could not be performed and why, with the controls and text on screen at that moment, so the script can be fixed.",
    inputSchema: obj({ file: str("The script's file name (.json).") }, ["file"]),
    async run(a, ctx) {
      const path = fileIn(ctx.folder, String(a.file), [".json"]);
      if (!existsSync(path)) throw new Error(`There is no script called "${a.file}".`);
      const v = validateScript(JSON.parse(readFileSync(path, "utf8")));
      if (!v.ok) return `It does not pass the format check, so it was not performed:\n${v.errors.map((e) => `- ${e.path}: ${e.message}`).join("\n")}`;
      const script = v.script!;
      const driver = script.driver ?? "hook";
      const session = await openProgram(ROOT, script.program.id, takeMonitor(), ctx.log, driver);
      try {
        const r = await rehearse(session, script, { allControls: [], check: formatOnly, frame: FRAME });
        if (r.passed) return `Passed: every one of the ${script.steps.length} steps could be performed.`;
        const f = r.repairs[0];
        const step = script.steps[f.step - 1];
        const listed = await session.hook.send<{ controls: ControlInfo[] }>({ cmd: "list" });
        const shown = listed.controls.filter((c) => c.visible).map((c) => `${c.id || "(no id)"}: "${c.label.slice(0, 60)}" (${c.role})`);
        let text: string[] = [];
        if (session.hello.hookVersion >= 2) text = [...new Set((await session.hook.send<{ items: TextOnScreen[] }>({ cmd: "text" })).items.map((t) => t.text))].slice(0, 60);
        return [
          `Failed at step ${f.step}${step ? ` (${stepWords(step)})` : ""}: ${f.error}`,
          `Controls on screen when it failed:\n${shown.join("\n") || "(none)"}`,
          ...(text.length ? [`Text on screen when it failed:\n${text.join("\n")}`] : []),
        ].join("\n\n");
      } finally {
        await session.close();
      }
    },
  },
];
