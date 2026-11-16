// The engine: every job Studio's window can start, by name, in one program. The window (src-tauri/src/engine.rs) starts
// it with the job's name and its settings as one JSON argument, and reads what it says back, one JSON object per line:
//
//   {"type":"log","text":"..."}         progress, in words, for the window's progress area
//   {"type":"result","value":{...}}     the job finished; what it found or made
//   {"type":"failed","message":"..."}   the job did not finish, and why, in words
//
// A key for a hosted AI service is never on the command line: the window writes it to the engine's standard input.
// `connector` is different: it is the connector (MCP) server itself, speaking its own protocol on standard input and
// output, started by an assistant (see docs/connector.md).
//
// node src/engine/main.ts <job> [<settings as JSON>]       (installed: node.exe engine\engine.mjs <job> ...)
//
// The same jobs the double-click files run; each calls the same code they do, so the window and the .bat files cannot
// drift apart.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { format } from "node:util";
import { isMain } from "../util/is-main.ts";

type Args = Record<string, unknown>;
type Emit = (o: Record<string, unknown>) => void;

const emit: Emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const log = (text: string) => emit({ type: "log", text });

/** Read everything the window wrote to standard input (a key), then stop reading. */
async function readSecret(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

const text = (a: Args, name: string): string | undefined => (typeof a[name] === "string" && (a[name] as string).trim() ? (a[name] as string).trim() : undefined);
const need = (a: Args, name: string): string => {
  const v = text(a, name);
  if (!v) throw new Error(`The job needs "${name}".`);
  return v;
};
const list = (a: Args, name: string): string[] => (Array.isArray(a[name]) ? (a[name] as unknown[]).filter((x): x is string => typeof x === "string" && !!x.trim()) : []);

/** What a render folder holds, for the window's list of videos. */
async function renderInfo(folder: string) {
  const { gate } = await import("../guard/review.ts");
  const reviewFile = join(folder, "review.json");
  if (!existsSync(reviewFile)) return { folder, name: basename(folder), reviewed: false, says: "It has no review yet.", open: false, at: 0 };
  const review = JSON.parse(readFileSync(reviewFile, "utf8"));
  const g = gate(review);
  return { folder, name: basename(folder), reviewed: true, says: g.says, open: g.open, at: statSync(reviewFile).mtimeMs };
}

const jobs: Record<string, (a: Args) => Promise<unknown>> = {
  /** Where everything is and what is ready: for the Home page. */
  async status() {
    const { workspace, examplesDir, computerSettings, appRoot, installed } = await import("../paths.ts");
    const { voicesRoot, voiceReady, plan, sizeText } = await import("../narration/voice-download.ts");
    const { readManifest } = await import("../pipeline/get-voice.ts");
    const { readLocalManifest, localAiFolder, localAiReady } = await import("../ai/local.ts");
    const { readAiSettings, describeChoice, settingsFile, PRESETS, HOSTED_NOTE } = await import("../ai/settings.ts");
    const { readConnector } = await import("../connector/settings.ts");
    const { authorExe, PROGRAMS } = await import("../pipeline/programs.ts");
    const left = (dir: string, m: Parameters<typeof plan>[1]) => plan(dir, m).reduce((n, s) => n + (s.complete ? 0 : s.file.size - s.have), 0);
    const vm = readManifest();
    const vdir = join(voicesRoot(), vm.folder);
    const am = readLocalManifest();
    const adir = localAiFolder(am);
    const ai = readAiSettings();
    const settings = computerSettings();
    const author = authorExe(appRoot());
    return {
      installed: installed(),
      workspace: workspace(),
      examples: examplesDir(),
      monitor: settings.monitor ?? 1,
      voice: { name: vm.name, ready: voiceReady(vdir, vm), folder: vdir, left: sizeText(left(vdir, vm)), licence: vm.licence, source: vm.source },
      builtinAi: { name: am.name, ready: localAiReady(am, adir), folder: adir, left: sizeText(left(adir, am)), licence: am.licence },
      ai: { choice: ai.choice, preset: ai.preset ?? null, model: ai.model ?? null, address: ai.address ?? null, pictures: ai.pictures ?? null, hasKey: !!ai.key, says: describeChoice(ai), file: settingsFile() },
      presets: PRESETS.map((p) => ({ id: p.id, name: p.name, defaultModel: p.defaultModel ?? null, custom: p.id === "custom" })),
      hostedNote: HOSTED_NOTE,
      programs: PROGRAMS.map((p) => ({ id: p.id, name: p.name, demos: (p.demos ?? []).map((d) => d.name) })),
      connector: readConnector(),
      authorExe: author,
    };
  },

  /** The scripts a person can make a video of, and the videos already made. */
  async library() {
    const { workspace, examplesDir } = await import("../paths.ts");
    const { collectScripts } = await import("../batch/scripts.ts");
    const ws = workspace();
    const places = [examplesDir(), join(ws, "scripts"), join(ws, "series")].filter((p) => existsSync(p));
    const seriesDirs = existsSync(join(ws, "series")) ? readdirSync(join(ws, "series"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(ws, "series", d.name)) : [];
    const scripts = collectScripts([...places.filter((p) => !p.endsWith("series")), ...seriesDirs])
      .filter((e) => e.script)
      .map((e) => ({ file: e.file, title: e.script!.title, steps: e.script!.steps.length, series: e.series?.folder ?? null, renderName: e.renderName }));
    const renders = join(ws, "renders");
    const videos = existsSync(renders)
      ? await Promise.all(readdirSync(renders, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(renders, d.name, "run-report.json"))).map((d) => renderInfo(join(renders, d.name))))
      : [];
    videos.sort((a, b) => b.at - a.at);
    const series = seriesDirs.filter((d) => existsSync(join(d, "plan.json")));
    const lectureDirs = [join(ws, "lectures"), join(examplesDir(), "lectures")].filter((d) => existsSync(d));
    const lectures = lectureDirs.flatMap((d) => readdirSync(d).filter((n) => n.toLowerCase().endsWith(".json")).map((n) => join(d, n)))
      .flatMap((file) => {
        try {
          const l = JSON.parse(readFileSync(file, "utf8"));
          return l.format === "openstage-studio-lecture" ? [{ file, title: String(l.title ?? basename(file)), slides: Array.isArray(l.slides) ? l.slides.length : 0 }] : [];
        } catch {
          return [];
        }
      });
    return { workspace: ws, scripts, videos, series, lectures };
  },

  async "make-video"(a) {
    const { makeVideo, takeMonitor, ScriptBlocked } = await import("../pipeline/make-video.ts");
    const { workspace } = await import("../paths.ts");
    const script = resolve(need(a, "script"));
    const out = join(workspace(), "renders", basename(script, ".json"));
    try {
      const made = await makeVideo(script, out, { monitor: takeMonitor(a.monitor as number | undefined), log });
      return { folder: made.folder, video: made.video, seconds: Math.round(made.timeline.durationMs / 100) / 10, flags: made.review?.flags.length ?? 0, frameDigest: made.frameDigest };
    } catch (e) {
      if (e instanceof ScriptBlocked) throw new Error(`${e.message} Change those words in the script (or the blocklist, if they are allowed), then make the video again.`);
      throw e;
    }
  },

  async "get-voice"() {
    const { voicesRoot, downloadVoice, progressText } = await import("../narration/voice-download.ts");
    const { readManifest } = await import("../pipeline/get-voice.ts");
    const m = readManifest();
    const dir = join(voicesRoot(), m.folder);
    let last = -1;
    await downloadVoice(m, dir, {
      onNote: log,
      onProgress: (p) => {
        const pct = Math.floor((p.done / p.total) * 100);
        if (pct !== last) {
          last = pct;
          log(progressText(p));
        }
      },
    });
    log(`The voice is ready: ${m.files.length} files, all matching their checksums.`);
    return { ready: true, folder: dir };
  },

  async "get-ai"() {
    const { getLocalAi } = await import("../ai/get-local.ts");
    return { ready: await getLocalAi(true, log) };
  },

  /** Save the AI choice (a key, if any, comes on standard input), then try it with one small question. */
  async "set-ai"(a) {
    const { readAiSettings, writeAiSettings, missing, describeChoice } = await import("../ai/settings.ts");
    const now = readAiSettings();
    const choice = need(a, "choice");
    if (choice !== "none" && choice !== "builtin" && choice !== "hosted") throw new Error(`"${choice}" is not one of none, builtin or hosted.`);
    let s: import("../ai/settings.ts").AiSettings = { choice };
    if (choice === "hosted") {
      const preset = need(a, "preset");
      const key = a.keyOnInput === true ? (await readSecret()).trim() : "";
      const same = now.choice === "hosted" && now.preset === preset;
      s = { choice, preset, model: text(a, "model"), ...(preset === "custom" ? { address: text(a, "address"), pictures: a.pictures === true } : {}), key: key || (same ? now.key : undefined) };
      const gap = missing(s);
      if (gap) throw new Error(`Not saved: ${gap}`);
    }
    if (choice === "builtin") {
      const { localAiReady, readLocalManifest } = await import("../ai/local.ts");
      if (!localAiReady(readLocalManifest())) throw new Error("The built-in model is not downloaded yet. Download it first (on this page), then choose it.");
    }
    writeAiSettings(s);
    log(`Saved: Studio uses ${describeChoice(s)}.`);
    if (choice !== "none") await jobs["test-ai"]({});
    return { says: describeChoice(s) };
  },

  async "test-ai"() {
    const { openAnswerer } = await import("../ai/ask.ts");
    const { readAiSettings } = await import("../ai/settings.ts");
    log("Trying it with one small question...");
    const ai = await openAnswerer(readAiSettings(), log);
    try {
      const answer = await ai.ask({ system: "Answer in one short sentence.", user: "Say that the connection works.", maxTokens: 200 });
      log(`It answered: ${answer.trim()}`);
      return { works: true, answer: answer.trim() };
    } finally {
      await ai.close();
    }
  },

  /** Notes or a manual's chapter become a lecture (src/lecture/write.ts); a person approves it before the video. */
  async "write-lecture"(a) {
    const { writeLecture } = await import("../lecture/write.ts");
    const r = await writeLecture(need(a, "source"), { chapter: text(a, "chapter"), useAi: a.useAi !== false, log });
    return { file: r.file, slides: r.lecture.slides.length, ai: r.ai, warnings: r.warnings };
  },

  /** What a lecture holds, whether it passes the check, and whether a person has approved it. */
  async "lecture-info"(a) {
    const { readLecture } = await import("../lecture/make-lecture.ts");
    const file = resolve(need(a, "file"));
    const r = readLecture(file);
    return {
      file, title: r.lecture.title, goal: r.lecture.goal, writtenBy: r.lecture.writtenBy ?? null, problems: r.problems, approved: r.approved,
      slides: (r.lecture.slides ?? []).map((s) => ({ title: s.title, points: s.points ?? [], narration: s.narration, picture: s.picture ?? null })),
    };
  },

  async "approve-lecture"(a) {
    const { approveLecture } = await import("../lecture/write.ts");
    const l = approveLecture(resolve(need(a, "file")), need(a, "by"));
    log(`Approved by ${l.approval!.by}.`);
    return { by: l.approval!.by, at: l.approval!.at };
  },

  async "make-lecture"(a) {
    const { makeLecture } = await import("../lecture/make-lecture.ts");
    const made = await makeLecture(need(a, "file"), { log });
    return { folder: made.folder, video: made.video, seconds: Math.round(made.timeline.durationMs / 100) / 10, flags: made.review?.flags.length ?? 0, frameDigest: made.frameDigest };
  },

  /** A recording (the shared capture format) becomes a draft script, checked in the program (src/recording/import.ts). */
  async "import-recording"(a) {
    const { importRecording } = await import("../recording/import.ts");
    const take = a.take === undefined || a.take === "" ? undefined : Number(a.take);
    if (take !== undefined && !Number.isInteger(take)) throw new Error("The take is a whole number.");
    const r = await importRecording(need(a, "project"), {
      ...(take !== undefined ? { take } : {}), demoProject: text(a, "demo"), title: text(a, "title"), goal: text(a, "goal"), log,
    });
    return { file: r.file, notesFile: r.notesFile, resolved: r.resolved, steps: r.draft.script.steps.length, take: r.draft.take, program: r.draft.program.name, notes: r.draft.notes, problems: r.problems };
  },

  async "plan-series"(a) {
    const { planSeries } = await import("../ai/series.ts");
    const folder = await planSeries(need(a, "manual"), { chapter: text(a, "chapter"), program: text(a, "program"), log });
    return { folder };
  },

  async "series-plan"(a) {
    const { readPlan } = await import("../ai/series.ts");
    const folder = resolve(need(a, "folder"));
    return { folder, plan: readPlan(folder) };
  },

  /** A person's choices for each planned video (approved, cut, or left proposed). */
  async "series-choose"(a) {
    const { readPlan, savePlan } = await import("../ai/series.ts");
    const folder = resolve(need(a, "folder"));
    const plan = readPlan(folder);
    const chosen = (a.statuses ?? {}) as Record<string, string>;
    for (const v of plan.videos) {
      const s = chosen[v.id];
      if (s === "approved" || s === "cut" || s === "proposed") v.status = s;
    }
    savePlan(folder, plan);
    const approved = plan.videos.filter((v) => v.status === "approved").length;
    log(`Saved: ${approved} of ${plan.videos.length} videos approved.`);
    return { approved };
  },

  async "write-series"(a) {
    const { writeSeries } = await import("../ai/series.ts");
    const written = await writeSeries(resolve(need(a, "folder")), { all: a.all === true, log });
    return { written };
  },

  async "rehearse-series"(a) {
    const { rehearseSeries } = await import("../ai/series.ts");
    const folder = resolve(need(a, "folder"));
    const r = await rehearseSeries(folder, { log });
    return { passed: r.passed, total: r.results.length, report: join(folder, "rehearsal.txt") };
  },

  async queue(a) {
    const { runQueue } = await import("../batch/queue.ts");
    const { workspace } = await import("../paths.ts");
    const paths = list(a, "paths");
    const r = await runQueue(paths.length ? paths : [join(workspace(), "series")], { log, ...(text(a, "program") ? { program: text(a, "program") } : {}) });
    const counts: Record<string, number> = {};
    for (const i of r.items) counts[i.outcome] = (counts[i.outcome] ?? 0) + 1;
    return { counts, report: join(workspace(), "renders", "queue-report.txt"), text: r.report };
  },

  async "release-check"(a) {
    const { releaseCheck } = await import("../batch/release.ts");
    const { workspace, examplesDir } = await import("../paths.ts");
    const paths = list(a, "paths");
    const r = await releaseCheck(paths.length ? paths : [join(workspace(), "series"), examplesDir()], { log, useAi: a.useAi !== false });
    return { checked: r.results.length, broken: r.broken.length, report: join(workspace(), "renders", "release-check", "report.txt"), text: r.text };
  },

  async export(a) {
    const { exportAll } = await import("../package/export.ts");
    const { workspace } = await import("../paths.ts");
    const out = resolve(text(a, "out") ?? join(workspace(), "packages"));
    const folders = list(a, "folders").map((f) => resolve(f));
    if (!folders.length) throw new Error("Choose at least one reviewed video to export.");
    mkdirSync(out, { recursive: true });
    const r = exportAll(folders, out, log);
    return { out, exported: r.exported.map((e) => e.folder), refused: r.refused };
  },

  /** Turn the connector on (for one folder) or off; give the lines that connect an assistant. */
  async "set-connector"(a) {
    const { readConnector, writeConnector } = await import("../connector/settings.ts");
    const { connectLines } = await import("../connector/setup.ts");
    if (a.on !== true) {
      const now = readConnector();
      writeConnector({ on: false, ...(now.folder ? { folder: now.folder } : {}) });
      log("The connector is off. An assistant that tries to use it is told how to turn it on.");
      return { on: false };
    }
    const folder = resolve(need(a, "folder"));
    if (!existsSync(folder)) {
      mkdirSync(folder, { recursive: true });
      log(`Made the folder ${folder}. Put the manuals you want scripts for in it.`);
    }
    writeConnector({ on: true, folder });
    log(`The connector is on, for ${folder} only.`);
    return { on: true, folder, ...connectLines() };
  },

  async "connector-lines"() {
    const { connectLines } = await import("../connector/setup.ts");
    return connectLines();
  },

  /** Studio's settings on this computer: the workspace, the take screen, OpenStage Author's program. */
  async "set-settings"(a) {
    const { readStudioSettings, writeStudioSettings, studioSettingsFile, workspace, installed, appRoot } = await import("../paths.ts");
    // Run from the repository, the work folder is the repository and the take screen is in local-settings.json.
    const file = installed() ? studioSettingsFile() : join(appRoot(), "local-settings.json");
    const s = readStudioSettings(file);
    if ("workspace" in a && installed()) {
      const w = text(a, "workspace");
      if (w) s.workspace = resolve(w);
      else delete s.workspace;
    }
    if ("monitor" in a) {
      const n = Number(a.monitor);
      if (!Number.isInteger(n) || n < 1 || n > 9) throw new Error("The take screen is a display number from 1 to 9.");
      s.monitor = n;
    }
    if ("authorExe" in a) {
      const p = text(a, "authorExe");
      if (p && !(existsSync(p) && extname(p).toLowerCase() === ".exe")) throw new Error(`${p} is not a program file (.exe).`);
      if (p) s.authorExe = resolve(p);
      else delete s.authorExe;
    }
    writeStudioSettings(s, file);
    log("Saved.");
    return { workspace: workspace(), monitor: s.monitor ?? 1, authorExe: s.authorExe ?? null };
  },

  async "start-blocklist"() {
    const { ensureLocalBlocklist } = await import("../guard/load.ts");
    const { workspace } = await import("../paths.ts");
    return ensureLocalBlocklist(workspace());
  },
};

export const JOBS = Object.keys(jobs);

async function run(job: string, json: string | undefined): Promise<number> {
  // Anything the code says on the console becomes a progress line, so nothing but these JSON lines reaches the window.
  for (const k of ["log", "info", "warn", "error"] as const) console[k] = (...parts: unknown[]) => log(format(...parts));
  const fn = jobs[job];
  if (!fn) {
    emit({ type: "failed", message: `"${job}" is not one of the engine's jobs (${JOBS.join(", ")}).` });
    return 2;
  }
  try {
    const args = json ? (JSON.parse(json) as Args) : {};
    if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error("The job's settings must be a JSON object.");
    emit({ type: "result", value: (await fn(args)) ?? {} });
    return 0;
  } catch (e) {
    emit({ type: "failed", message: e instanceof Error ? e.message : String(e) });
    return 1;
  }
}

if (isMain(import.meta.url, true)) {
  const [job, json] = process.argv.slice(2);
  if (job === "connector") {
    const { startServer } = await import("../connector/server.ts");
    await startServer();
  } else {
    process.exitCode = await run(job ?? "", json);
    // Helper programs and servers a job started are already stopped; exit even if a timer or socket lingers.
    setTimeout(() => process.exit(), 50).unref();
  }
}
