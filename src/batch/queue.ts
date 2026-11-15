// The queue: record a whole manual, or every script in some folders, with nobody watching (phase 4).
//
// Given a manual, it plans every chapter that has tasks, writes each video's script and rehearses it (as phase 3 does,
// with the AI that Set Up AI.bat chose), into series\<program>-<chapter>\. Then, for every script in the queue, it
// rehearses the script against the program as it is now (never changing it) and records each one that passes. A script
// that breaks is skipped; with an AI chosen, a repaired copy is saved beside it to read, and is never recorded.
//
// It carries on where it stopped: a video already made from the very same script is not made again. The computer and its
// screen are kept awake meanwhile. Every video still waits for a person to review and approve it before export.
//
// node src/batch/queue.ts [<manual, series folder, folder of scripts, or script>...]
// With nothing named: every series under series\.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openAnswerer, type Answerer } from "../ai/ask.ts";
import { slug } from "../ai/roles.ts";
import { planSeries, programFacts, programFor, readPlan, rehearseSeries, writeSeries, type ProgramFacts } from "../ai/series.ts";
import { describeChoice, readAiSettings } from "../ai/settings.ts";
import { importManual } from "../manual/import.ts";
import { helperPath } from "../pipeline/helper.ts";
import { FRAME, makeVideo, takeMonitor } from "../pipeline/make-video.ts";
import { openProgram } from "../pipeline/program-session.ts";
import { gate } from "../guard/review.ts";
import { checkScript, stepWords, type ScriptCheck } from "./check-script.ts";
import { collectScripts, fileDigest, type ScriptEntry } from "./scripts.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Keep the computer and its screen awake until the returned function is called. */
export function keepAwake(): () => void {
  try {
    const child = spawn(helperPath(ROOT), ["awake"], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    child.on("error", () => undefined);
    return () => {
      child.stdin?.end();
      setTimeout(() => child.kill(), 2000).unref();
    };
  } catch {
    return () => undefined;
  }
}

/** What has been recorded, by render folder: the script's fingerprint when it was made. Kept in <renders>\queue-state.json. */
type State = Record<string, { script: string; digest: string; video: string }>;

const readState = (file: string): State => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as State;
  } catch {
    return {};
  }
};

export interface QueueItem {
  entry: ScriptEntry;
  outcome: "recorded" | "already made" | "broken" | "not valid" | "not recorded";
  check?: ScriptCheck;
  /** Where the video is, and what review says. */
  video?: string;
  review?: string;
  error?: string;
}

export interface QueueResult {
  items: QueueItem[];
  /** Chapters planned, and any left out with why. */
  chapters: { title: string; folder?: string; videos: number; note?: string }[];
  ai: string;
  report: string;
}

const isManual = (p: string) => [".openexplainer", ".pdf"].includes(extname(p).toLowerCase());

export async function runQueue(paths: string[], o: { log?: (s: string) => void; seriesRoot?: string; rendersRoot?: string; program?: string } = {}): Promise<QueueResult> {
  const log = o.log ?? console.log;
  const seriesRoot = o.seriesRoot ?? join(ROOT, "series");
  const rendersRoot = o.rendersRoot ?? join(ROOT, "renders");
  const stateFile = join(rendersRoot, "queue-state.json");
  mkdirSync(rendersRoot, { recursive: true });
  const settings = readAiSettings();
  const ai = settings.choice === "none" ? "no AI" : describeChoice(settings);
  const stopAwake = keepAwake();
  let answerer: Answerer | null = null;
  const chapters: QueueResult["chapters"] = [];
  const items: QueueItem[] = [];
  try {
    if (settings.choice !== "none") answerer = await openAnswerer(settings, log);

    // 1. Manuals: a series for every chapter with tasks (planned, written and rehearsed once; then left as they are).
    const queuePaths: string[] = [];
    for (const p of paths.map((x) => resolve(x))) {
      if (!isManual(p)) {
        queuePaths.push(p);
        continue;
      }
      if (!answerer) throw new Error(`Planning videos from ${basename(p)} needs an AI. Run "Set Up AI.bat", or write the scripts by hand and queue their folder.`);
      const manual = await importManual(p);
      const program = programFor(o.program, manual.product);
      log(`\n=== ${manual.title}: ${manual.chapters.length} chapter(s), for ${program.name} ===`);
      const session = await openProgram(ROOT, program.id, takeMonitor(), log);
      try {
        for (const [i, chapter] of manual.chapters.entries()) {
          if (manual.kind === "project" && chapter.topics.every((t) => !t.procedures.length)) {
            chapters.push({ title: chapter.title, videos: 0, note: "no tasks with steps" });
            log(`"${chapter.title}" has no tasks with steps; no videos.`);
            continue;
          }
          const folder = join(seriesRoot, `${program.id}-${slug(chapter.title)}`);
          if (!existsSync(join(folder, "plan.json"))) await planSeries(p, { chapter: String(i + 1), program: program.id, answerer, log, seriesRoot });
          const plan = readPlan(folder);
          const live = plan.videos.filter((v) => v.status !== "cut");
          if (!live.length) {
            chapters.push({ title: chapter.title, folder, videos: 0, note: "the plan has no videos" });
            continue;
          }
          if (live.some((v) => !v.script)) await writeSeries(folder, { all: true, onlyMissing: true, answerer, session, log });
          if (readPlan(folder).videos.some((v) => v.script && v.status !== "cut" && !v.rehearsal)) await rehearseSeries(folder, { answerer, session, onlyUnrehearsed: true, log });
          chapters.push({ title: chapter.title, folder, videos: live.length });
          queuePaths.push(folder);
        }
      } finally {
        await session.close();
      }
    }

    // 2. Every script in the queue: rehearse against the program as it is now, then record those that pass.
    const entries = collectScripts(queuePaths);
    const state = readState(stateFile);
    const toCheck: ScriptEntry[] = [];
    for (const e of entries) {
      if (!e.script) {
        items.push({ entry: e, outcome: "not valid", error: e.problem });
        continue;
      }
      const made = state[e.renderName];
      if (made && made.digest === fileDigest(e.file) && existsSync(made.video)) items.push({ entry: e, outcome: "already made", video: made.video });
      else toCheck.push(e);
    }
    const toRecord: ScriptEntry[] = [];
    const byProgram = new Map<string, ScriptEntry[]>();
    for (const e of toCheck) byProgram.set(e.script!.program.id, [...(byProgram.get(e.script!.program.id) ?? []), e]);
    for (const [programId, list] of byProgram) {
      log(`\n=== Rehearsing ${list.length} script(s) for ${programId} ===`);
      let session;
      try {
        session = await openProgram(ROOT, programId, takeMonitor(), log);
      } catch (e) {
        for (const x of list) items.push({ entry: x, outcome: "not recorded", error: `The program could not be started: ${e instanceof Error ? e.message : String(e)}` });
        continue;
      }
      try {
        let facts: ProgramFacts | null = null;
        try {
          facts = await programFacts(session);
        } catch {
          facts = null;
        }
        for (const x of list) {
          log(`Rehearsing ${relative(ROOT, x.file)}.`);
          try {
            const check = await checkScript(session, x.file, x.script!, { facts, answerer, frame: FRAME, log });
            if (check.works) toRecord.push(x);
            else items.push({ entry: x, outcome: "broken", check });
          } catch (e) {
            items.push({ entry: x, outcome: "not recorded", error: `It could not be rehearsed: ${e instanceof Error ? e.message : String(e)}` });
          }
        }
      } finally {
        await session.close();
      }
    }
    for (const [n, x] of toRecord.entries()) {
      log(`\n=== Recording ${n + 1} of ${toRecord.length}: ${relative(ROOT, x.file)} ===`);
      const folder = join(rendersRoot, x.renderName);
      try {
        const made = await makeVideo(x.file, folder, { monitor: takeMonitor(), log });
        state[x.renderName] = { script: x.file, digest: fileDigest(x.file), video: made.video };
        writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n");
        items.push({ entry: x, outcome: "recorded", video: made.video, ...(made.review ? { review: gate(made.review).says } : {}) });
      } catch (e) {
        items.push({ entry: x, outcome: "not recorded", error: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    await answerer?.close();
    stopAwake();
  }
  const report = queueText(items, chapters, ai);
  writeFileSync(join(rendersRoot, "queue-report.txt"), report);
  return { items, chapters, ai, report };
}

export function queueText(items: QueueItem[], chapters: QueueResult["chapters"], ai: string): string {
  const name = (i: QueueItem) => relative(ROOT, i.entry.file);
  const count = (k: QueueItem["outcome"]) => items.filter((i) => i.outcome === k).length;
  const lines = [
    "Queue report",
    `AI: ${ai}.`,
    "",
    `${items.length} script(s): ${count("recorded")} recorded now, ${count("already made")} already made, ${count("broken")} broken, ${count("not recorded")} not recorded, ${count("not valid")} not valid.`,
  ];
  if (chapters.length) {
    lines.push("", "CHAPTERS:");
    for (const c of chapters) lines.push(`- ${c.title}: ${c.videos} video(s)${c.note ? ` (${c.note})` : ""}`);
  }
  const section = (title: string, k: QueueItem["outcome"], detail: (i: QueueItem) => string[]) => {
    const list = items.filter((i) => i.outcome === k);
    if (!list.length) return;
    lines.push("", `${title}:`);
    for (const i of list) lines.push(`- ${name(i)}`, ...detail(i).map((d) => `    ${d}`));
  };
  section("RECORDED", "recorded", (i) => [`Video: ${relative(ROOT, i.video!)}`, ...(i.review ? [`Review: ${i.review}`] : [])]);
  section("BROKEN, NOT RECORDED", "broken", (i) => {
    const b = i.check!.broken!;
    return [
      `Step ${b.step}${b.what ? ` (${stepWords(b.what)})` : ""}: ${b.error}`,
      i.check!.repairedFile ? `A repaired copy passed rehearsal: ${relative(ROOT, i.check!.repairedFile)}. Read it; if it is right, replace the script with it.` : `No repaired copy: ${i.check!.unrepaired}`,
    ];
  });
  section("NOT RECORDED", "not recorded", (i) => [i.error ?? ""]);
  section("NOT VALID SCRIPTS", "not valid", (i) => [i.error ?? ""]);
  section("ALREADY MADE FROM THIS VERSION OF THE SCRIPT", "already made", (i) => [`Video: ${relative(ROOT, i.video!)}`]);
  lines.push("", "Next: review each new video (Review Video.bat, or Review a video in the app), approve it, then Export Packages.bat.");
  return lines.join("\n") + "\n";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--program");
  const paths = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--program");
  runQueue(paths.length ? paths : [join(ROOT, "series")], { ...(at >= 0 ? { program: args[at + 1] } : {}) }).then(
    (r) => {
      console.log(`\n${r.report}`);
      console.log(`The report is in ${join(ROOT, "renders", "queue-report.txt")}`);
      process.exit(r.items.some((i) => i.outcome === "broken" || i.outcome === "not recorded") ? 1 : 0);
    },
    (e) => {
      console.error(`\nThe queue did not finish: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    },
  );
}
