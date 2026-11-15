// A series: the videos planned from one chapter of a manual, and their scripts. Everything the AI makes goes into a
// series folder as plain files a person reads and edits before anything is recorded:
//
//   series\<program>-<chapter>\plan.json            the video list: title, goal, playlist order, and each one's status
//                              01-<video>.json      a tutorial script for each approved (or, with --all, proposed) video
//                              rehearsal.txt        what rehearsal found and repaired, script by script
//                              studio-project.json  the voice and paces, as for any project
//
// node src/ai/series.ts plan <manual> [--chapter <number or words>] [--program <id>]
// node src/ai/series.ts write <series folder> [--all]
// node src/ai/series.ts rehearse <series folder>
// node src/ai/series.ts run <manual> [--chapter ...] [--program ...]      all three in turn (the acceptance test)

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openAnswerer, type Answerer } from "./ask.ts";
import { rehearse, type Rehearsal } from "./rehearse.ts";
import { planVideos, slug, writeMetadata, writeScript, type PlannedVideo } from "./roles.ts";
import { describeChoice, readAiSettings } from "./settings.ts";
import { importManual } from "../manual/import.ts";
import { chapterText, findChapter, type Chapter } from "../manual/manual.ts";
import { openProgram, readControls, type ControlFact, type ProgramSession } from "../pipeline/program-session.ts";
import { PROGRAMS, type ProgramEntry } from "../pipeline/programs.ts";
import { FRAME, takeMonitor } from "../pipeline/make-video.ts";
import { scanScript, describeScriptHit } from "../guard/script-scan.ts";
import { loadBlocklist } from "../guard/load.ts";
import type { Script } from "../script/format.ts";
import { validateScript } from "../script/validate.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface Plan {
  format: "openstage-studio-plan";
  version: 1;
  program: { id: string; name: string };
  manual: { title: string; file: string; chapter: string; chapterId: string };
  playlist: string;
  writtenBy: { kind: "model"; name: string };
  videos: (PlannedVideo & { script?: string; rehearsal?: "passed" | "failed" })[];
}

const readPlan = (folder: string) => JSON.parse(readFileSync(join(folder, "plan.json"), "utf8")) as Plan;
const savePlan = (folder: string, p: Plan) => writeFileSync(join(folder, "plan.json"), JSON.stringify(p, null, 2) + "\n");

/** The program a manual is about: named on the command line, or found from the manual's product name. */
function programFor(asked: string | undefined, product: string | undefined): ProgramEntry {
  const p = asked ? PROGRAMS.find((x) => x.id === asked) : PROGRAMS.find((x) => product && x.name.toLowerCase() === product.toLowerCase());
  if (!p) throw new Error(`Say which program the manual is about with --program (one of ${PROGRAMS.map((x) => x.id).join(", ")}).`);
  return p;
}

/** The manual's words for the topics a video covers (the whole chapter if none match). */
function textFor(chapter: Chapter, covers: string[]): string {
  const want = covers.map((c) => c.toLowerCase().trim());
  const topics = chapter.topics.filter((t) => t.depth > 0 && want.some((w) => t.title.toLowerCase() === w || t.title.toLowerCase().includes(w) || w.includes(t.title.toLowerCase())));
  return chapterText(topics.length ? { ...chapter, topics } : chapter);
}

interface ProgramFacts {
  /** Controls with the first demo project open (what the writer is shown). */
  controls: ControlFact[];
  /** Every control any demo project has. */
  all: ControlFact[];
}

async function programFacts(s: ProgramSession): Promise<ProgramFacts> {
  const demos = s.program.demos?.map((d) => d.name) ?? [];
  if (!demos.length) throw new Error(`${s.program.name} lists no demo projects in src/pipeline/programs.ts, so a script cannot say where to start.`);
  const byDemo = [];
  for (const d of demos) byDemo.push(await readControls(s, d));
  const all = new Map<string, ControlFact>();
  for (const list of byDemo) for (const c of list) if (!all.has(c.id)) all.set(c.id, c);
  return { controls: byDemo[0], all: [...all.values()] };
}

/** The check every AI-written script must pass: the format, the program's real controls, its demo projects, and the
 * script scan (no blocked names). */
function checker(program: ProgramEntry, all: ControlFact[]) {
  const list = loadBlocklist(ROOT).list;
  const demos = new Set(program.demos?.map((d) => d.name) ?? []);
  const roles = new Map(all.map((c) => [c.id, c.role]));
  return (s: Script): string[] => {
    const v = validateScript(s, { controls: all.map((c) => c.id), controlPatterns: (program.appearing ?? []).map((a) => a.pattern) });
    const problems = v.errors.map((e) => `${e.path}: ${e.message}`);
    const demo = (s as { startState?: { demoProject?: string } }).startState?.demoProject;
    if (demos.size && demo && !demos.has(demo)) problems.push(`startState.demoProject: "${demo}" is not one of the demo projects (${[...demos].join(", ")}).`);
    for (const [i, step] of (s.steps ?? []).entries()) {
      if (step?.action === "open" && step.value && demos.size && !demos.has(step.value)) problems.push(`steps[${i}].value: "${step.value}" is not one of the demo projects.`);
      // Clicking a drop-down list only opens it; a choice is made by typing its words. Without this, a script can pass
      // rehearsal (every click works) and still never choose anything.
      if (step?.action === "click" && step.target && roles.get(step.target) === "combobox") {
        problems.push(`steps[${i}]: "${step.target}" is a drop-down list. To choose from it, use {"action": "type", "target": "${step.target}", "value": "<the choice's words>"} instead of clicking it.`);
      }
      // The same step twice in a row is a slip (a repair often leaves the step it replaced behind).
      const prev = i > 0 ? s.steps[i - 1] : undefined;
      if (prev && step && prev.action === step.action && prev.target === step.target && prev.value === step.value && step.action !== "scroll" && step.action !== "key") {
        problems.push(`steps[${i}]: it repeats step ${i} exactly. Remove one of them.`);
      }
    }
    if (v.ok) problems.push(...scanScript(v.script!, list).map(describeScriptHit));
    return problems;
  };
}

export async function planSeries(manualFile: string, o: { chapter?: string; program?: string; answerer?: Answerer; log?: (s: string) => void } = {}): Promise<string> {
  const log = o.log ?? console.log;
  const manual = await importManual(resolve(manualFile));
  const chapter = findChapter(manual, o.chapter);
  const program = programFor(o.program, manual.product);
  const a = o.answerer ?? (await openAnswerer(readAiSettings(), log));
  try {
    log(`Planning videos for "${chapter.title}" in ${manual.title}, with ${a.name}.`);
    const planned = await planVideos(a, program, manual.title, chapter.title, chapterText(chapter));
    const folder = join(ROOT, "series", `${program.id}-${slug(chapter.title)}`);
    mkdirSync(folder, { recursive: true });
    const plan: Plan = {
      format: "openstage-studio-plan", version: 1,
      program: { id: program.id, name: program.name },
      manual: { title: manual.title, file: resolve(manualFile), chapter: chapter.title, chapterId: chapter.id },
      playlist: planned.playlist,
      writtenBy: { kind: "model", name: a.name },
      videos: planned.videos,
    };
    savePlan(folder, plan);
    if (!existsSync(join(folder, "studio-project.json"))) copyFileSync(join(ROOT, "examples", "studio-project.json"), join(folder, "studio-project.json"));
    log(`The plan has ${plan.videos.length} videos, in this order:`);
    plan.videos.forEach((v) => log(`  ${v.position}. ${v.title}: ${v.goal}`));
    log(`It is in ${join(folder, "plan.json")}. Read it, then set "status" to "approved" (or "cut") for each video, or merge, split and reword them. Write Scripts.bat writes the approved ones.`);
    return folder;
  } finally {
    if (!o.answerer) await a.close();
  }
}

export async function writeSeries(folder: string, o: { all?: boolean; answerer?: Answerer; session?: ProgramSession; log?: (s: string) => void } = {}): Promise<number> {
  const log = o.log ?? console.log;
  const plan = readPlan(folder);
  const program = programFor(plan.program.id, undefined);
  const approved = plan.videos.filter((v) => v.status === "approved");
  const chosen = approved.length ? approved : o.all ? plan.videos.filter((v) => v.status !== "cut") : [];
  if (!chosen.length) {
    log("No video in the plan is approved yet. Set a video's \"status\" to \"approved\" in plan.json, or run this with --all to write every proposed video.");
    return 0;
  }
  const manual = await importManual(plan.manual.file);
  const chapter = manual.chapters.find((c) => c.id === plan.manual.chapterId) ?? findChapter(manual, plan.manual.chapter);
  const session = o.session ?? (await openProgram(ROOT, program.id, takeMonitor(), log));
  const a = o.answerer ?? (await openAnswerer(readAiSettings(), log));
  let written = 0;
  try {
    const facts = await programFacts(session);
    const check = checker(program, facts.all);
    for (const v of chosen) {
      log(`Writing the script for "${v.title}".`);
      try {
        const { script, rounds } = await writeScript(a, { program, video: v, manualText: textFor(chapter, v.covers), controls: facts.controls, check });
        const full: Script = {
          ...script,
          playlist: { name: plan.playlist, position: v.position },
          writtenBy: { kind: "model", name: a.name, editedByPerson: false },
        };
        const file = `${String(v.position).padStart(2, "0")}-${v.id}.json`;
        writeFileSync(join(folder, file), JSON.stringify(full, null, 2) + "\n");
        v.script = file;
        delete v.rehearsal;
        written++;
        log(`  Wrote ${file} (${full.steps.length} steps${rounds > 1 ? `, after ${rounds} tries` : ""}).`);
      } catch (e) {
        log(`  Not written: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    savePlan(folder, plan);
  } finally {
    if (!o.answerer) await a.close();
    if (!o.session) await session.close();
  }
  return written;
}

export interface SeriesRehearsal {
  results: { video: string; file: string; rehearsal: Rehearsal | null; error?: string }[];
  passed: number;
}

export async function rehearseSeries(folder: string, o: { answerer?: Answerer | null; session?: ProgramSession; maxRepairs?: number; log?: (s: string) => void } = {}): Promise<SeriesRehearsal> {
  const log = o.log ?? console.log;
  const plan = readPlan(folder);
  const program = programFor(plan.program.id, undefined);
  const session = o.session ?? (await openProgram(ROOT, program.id, takeMonitor(), log));
  const settings = readAiSettings();
  const a = o.answerer === undefined ? (settings.choice === "none" ? null : await openAnswerer(settings, log)) : o.answerer;
  const results: SeriesRehearsal["results"] = [];
  try {
    const facts = await programFacts(session);
    const check = checker(program, facts.all);
    for (const v of plan.videos.filter((x) => x.script && x.status !== "cut")) {
      const file = join(folder, v.script!);
      log(`Rehearsing "${v.title}".`);
      try {
        const script = JSON.parse(readFileSync(file, "utf8")) as Script;
        const r = await rehearse(session, script, { ...(a ? { answerer: a } : {}), maxRepairs: o.maxRepairs ?? 3, allControls: facts.all, check, frame: FRAME, log });
        let final = r.script;
        if (r.passed && a) {
          try {
            final = (await writeMetadata(a, final)).script;
          } catch (e) {
            log(`  The publishing details were not written: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (final !== script) writeFileSync(file, JSON.stringify(final, null, 2) + "\n");
        v.rehearsal = r.passed ? "passed" : "failed";
        results.push({ video: v.title, file: v.script!, rehearsal: { ...r, script: final } });
        log(`  ${r.passed ? "PASSED" : "FAILED"} after ${r.runs} run(s) and ${r.repairs.filter((x) => x.why).length} repair(s).`);
      } catch (e) {
        v.rehearsal = "failed";
        results.push({ video: v.title, file: v.script!, rehearsal: null, error: e instanceof Error ? e.message : String(e) });
        log(`  FAILED: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    savePlan(folder, plan);
  } finally {
    if (a && o.answerer === undefined) await a.close();
    if (!o.session) await session.close();
  }
  const passed = results.filter((r) => r.rehearsal?.passed).length;
  writeFileSync(join(folder, "rehearsal.txt"), rehearsalReport(plan, results, passed, a?.name ?? "no AI"));
  return { results, passed };
}

function rehearsalReport(plan: Plan, results: SeriesRehearsal["results"], passed: number, ai: string): string {
  const lines = [`Rehearsal: ${plan.manual.chapter} (${plan.manual.title}), ${plan.program.name}`, `Repairs by: ${ai}`, ""];
  for (const r of results) {
    lines.push(`${r.rehearsal?.passed ? "PASSED" : "FAILED"}: ${r.video} (${r.file})`);
    if (r.error) lines.push(`  ${r.error}`);
    for (const x of r.rehearsal?.repairs ?? []) {
      lines.push(`  Step ${x.step} was flagged: ${x.error}`);
      if (x.why) lines.push(`    Repaired (steps ${x.replaced![0]} to ${x.replaced![1]} replaced): ${x.why}`);
      if (x.unrepaired) lines.push(`    Not repaired: ${x.unrepaired}`);
    }
  }
  lines.push("", `${passed} of ${results.length} scripts passed rehearsal.`);
  return lines.join("\n") + "\n";
}

/** Plan, write every proposed video, and rehearse: the acceptance test. No person edits anything in between. */
export async function runSeries(manualFile: string, o: { chapter?: string; program?: string; log?: (s: string) => void } = {}): Promise<{ folder: string; passed: number; total: number; ai: string }> {
  const log = o.log ?? console.log;
  const settings = readAiSettings();
  log(`AI: ${describeChoice(settings)}.`);
  const a = await openAnswerer(settings, log);
  try {
    const folder = await planSeries(manualFile, { ...o, answerer: a, log });
    const manual = await importManual(resolve(manualFile));
    const program = programFor(o.program, manual.product);
    const session = await openProgram(ROOT, program.id, takeMonitor(), log);
    try {
      await writeSeries(folder, { all: true, answerer: a, session, log });
      const r = await rehearseSeries(folder, { answerer: a, session, log });
      const total = readPlan(folder).videos.filter((v) => v.status !== "cut").length;
      return { folder, passed: r.passed, total, ai: a.name };
    } finally {
      await session.close();
    }
  } finally {
    await a.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [what, target, ...rest] = process.argv.slice(2);
  const value = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const fail = (e: unknown) => {
    console.error(`\nThat did not finish: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  };
  if (!target) {
    console.error("Say what to do (plan, write, rehearse or run) and with which manual or series folder.");
    process.exit(2);
  }
  if (what === "plan") planSeries(target, { chapter: value("--chapter"), program: value("--program") }).catch(fail);
  else if (what === "write") writeSeries(resolve(target), { all: rest.includes("--all") }).then((n) => process.exit(n ? 0 : 1), fail);
  else if (what === "rehearse") rehearseSeries(resolve(target)).then((r) => {
    console.log(`\n${r.passed} of ${r.results.length} scripts passed rehearsal. The report is in ${join(resolve(target), "rehearsal.txt")}`);
    process.exit(r.passed === r.results.length ? 0 : 1);
  }, fail);
  else if (what === "run") runSeries(target, { chapter: value("--chapter"), program: value("--program") }).then((r) => {
    const share = r.total ? r.passed / r.total : 0;
    console.log(`\n${r.passed} of ${r.total} scripts passed rehearsal with ${r.ai}, with no hand edits (${Math.round(share * 100)} percent; the bar is 80 percent).`);
    console.log(share >= 0.8 ? "PASS: at least four in five scripts passed rehearsal after automatic repair." : "FAIL: fewer than four in five passed.");
    console.log(`The plan, the scripts and the rehearsal report are in ${r.folder}`);
    process.exit(share >= 0.8 ? 0 : 1);
  }, fail);
  else {
    console.error(`"${what}" is not one of plan, write, rehearse or run.`);
    process.exit(2);
  }
}
