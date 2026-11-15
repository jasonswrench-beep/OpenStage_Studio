// Makes one video from one script, from start to finish:
//
//   1. check the script against the format
//   2. make the narration, one clip per line (clips already made are reused)
//   3. the take: start the program in demo mode and perform the script, saving a still picture after every change
//   4. build the timeline from the narration's lengths
//   5. write the captions (SRT and VTT), the transcript and the chapter list
//   6. assemble the finished MP4 (1920 by 1080, 30 frames a second), with any blurred boxes from review
//   7. the guard: the frame scan reads the text in every picture; the flags go to review.json and guard-report.txt
//   8. the thumbnail for the publishing package
//
// The script scan runs first of all: a script that would say, type or show a blocked name is stopped before anything
// is recorded. Nothing made here leaves this computer: the publishing package is made only after a person has resolved
// every flag and approved the video (src/package/export.ts).
//
// node src/pipeline/make-video.ts <script.json> [--out <folder>] [--monitor <n>] [--blocklist <file>]...

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeCaptions, makeChapters, makeTranscript, toSrt, toVtt } from "../captions/captions.ts";
import { clipKey, DEFAULT_VOICE, narrationLines, type Pronunciations, type VoiceSettings } from "../narration/narration.ts";
import type { Script } from "../script/format.ts";
import { describeProblems, validateScript } from "../script/validate.ts";
import { buildTimeline, type Paces, type TakeLog, type Timeline } from "../timeline/build.ts";
import { HookServer } from "./hook-server.ts";
import { helperPath, runHelper, TakeSession, wavDurationMs } from "./helper.ts";
import { play } from "./player.ts";
import { readManifest } from "./get-voice.ts";
import { voiceReady, voicesRoot } from "../narration/voice-download.ts";
import { findProgram } from "./programs.ts";
import { describeScriptHit, scanScript, scriptTexts } from "../guard/script-scan.ts";
import { loadBlocklist, type LoadedBlocklist } from "../guard/load.ts";
import { scanFrames, type OcrResult } from "../guard/frame-scan.ts";
import { redactionSpans } from "../guard/redact.ts";
import { carryDecisions, gate, guardReport, REVIEW_FORMAT, type Review } from "../guard/review.ts";
import { makeDraft, thumbnailPlan, type ProjectPublishSettings } from "../package/package.ts";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const FRAME: [number, number] = [1920, 1080];
export const FPS = 30;
/** How long a program is given to finish starting before the first step of a take. */
export const WARM_UP_MS = 5000;

/** Settings for this computer only, kept in local-settings.json beside this project (git ignores it), such as which
 * display takes use: `{ "monitor": 2 }` puts the program being recorded on the second display. */
export function localSettings(): { monitor?: number } {
  const file = join(ROOT, "local-settings.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as { monitor?: number };
  } catch {
    return {};
  }
}

/** The display takes use: the one asked for, else this computer's setting, else the main display. */
export function takeMonitor(asked?: string | number): number {
  const n = Number(asked ?? localSettings().monitor ?? 1);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Settings shared by every video of a project: the voice, how names are said, and the paces. */
export interface ProjectSettings {
  voice: VoiceSettings;
  pronunciations: Pronunciations;
  paces?: Partial<Paces>;
  /** The thumbnail template and the description's narration line (src/package/package.ts). */
  publish?: ProjectPublishSettings;
}

export function readProjectSettings(scriptPath: string): ProjectSettings {
  const file = join(dirname(scriptPath), "studio-project.json");
  const settings: ProjectSettings = { voice: { ...DEFAULT_VOICE }, pronunciations: {} };
  if (!existsSync(file)) return settings;
  const data = JSON.parse(readFileSync(file, "utf8")) as Partial<ProjectSettings>;
  return { voice: { ...settings.voice, ...data.voice }, pronunciations: data.pronunciations ?? {}, paces: data.paces, publish: data.publish };
}

export interface MadeVideo {
  folder: string;
  video: string;
  timeline: Timeline;
  take: TakeLog;
  frameDigest: string;
  soundDigest: string | null;
  /** The review, if the frame scan ran. */
  review?: Review;
}

/** A script the script scan stopped. Nothing was recorded. */
export class ScriptBlocked extends Error {
  readonly hits: number;
  constructor(hits: number) {
    super(`The script scan found ${hits} blocked thing${hits === 1 ? "" : "s"} in the script, so nothing was recorded. Change the words, or add your own names to the allowlist in blocklist.local.json.`);
    this.hits = hits;
  }
}

export interface MakeOptions {
  monitor?: number;
  log?: (s: string) => void;
  clipDir?: string;
  /** More blocklists to use, besides this computer's blocklist.local.json. */
  blocklists?: string[];
  /** Whether to read the text in the pictures (on unless switched off, as the repeat check does to save time). */
  frameScan?: boolean;
}

const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 24);

export async function makeVideo(scriptPath: string, outFolder: string, options: MakeOptions = {}): Promise<MadeVideo> {
  const log = options.log ?? ((s: string) => console.log(s));
  const helper = helperPath(ROOT);

  // 1. Check the script.
  const v = validateScript(JSON.parse(readFileSync(scriptPath, "utf8")));
  for (const line of describeProblems(v)) log(line);
  if (!v.ok) throw new Error(`The script has ${v.errors.length} error(s) and was not recorded.`);
  const script = v.script as Script;
  const settings = readProjectSettings(scriptPath);

  // The script scan, before anything is recorded.
  const blocklist = loadBlocklist(ROOT, (options.blocklists ?? []).map((b) => resolve(b)));
  blocklist.problems.forEach((p) => log(`Note: ${p}`));
  const scriptHits = scanScript(script, blocklist.list);
  if (scriptHits.length) {
    scriptHits.forEach((h) => log(describeScriptHit(h)));
    throw new ScriptBlocked(scriptHits.length);
  }
  log(`The script scan found nothing blocked (${scriptTexts(script).length} pieces of text, ${blocklist.list.terms.length} blocked terms and the built-in patterns).`);
  mkdirSync(outFolder, { recursive: true });

  // 2. Narration: one clip per line, kept by what shapes its sound, so unchanged lines are never made again.
  const engine = settings.voice.engine;
  if (engine !== "windows" && engine !== "kokoro") throw new Error(`The narration engine "${engine}" is not built yet. Use "kokoro" or "windows".`);
  let modelDir: string | undefined;
  if (engine === "kokoro") {
    const m = readManifest();
    modelDir = join(voicesRoot(), m.folder);
    if (!voiceReady(modelDir, m)) throw new Error("The voice is not downloaded yet. Run \"Get Voice.bat\" first (about 340 MB, once).");
    settings.voice = { ...settings.voice, model: m.revision };
  }
  const lines = narrationLines(script, settings.pronunciations);
  const clipDir = options.clipDir ?? resolve(ROOT, "work/narration");
  mkdirSync(clipDir, { recursive: true });
  const clipFile = new Map(lines.map((l) => [l.id, join(clipDir, `${fingerprint(clipKey(l, settings.voice))}.wav`)]));
  const missing = lines.filter((l) => !existsSync(clipFile.get(l.id)!));
  if (missing.length) {
    log(`Making ${missing.length} narration clip(s) of ${lines.length}.`);
    const jobsFile = join(outFolder, "narration-jobs.json");
    writeFileSync(jobsFile, JSON.stringify({ engine, ...(modelDir ? { modelDir } : {}), voice: settings.voice.voice, rate: settings.voice.rate, jobs: missing.map((l) => ({ text: l.spoken, out: clipFile.get(l.id) })) }, null, 2));
    await runHelper(helper, ["speak", "--jobs", jobsFile], (e) => e.event === "voice" && log(`Voice: ${e.name}.`));
  } else log(`All ${lines.length} narration clips are already made.`);
  const clips: Record<string, number> = {};
  for (const l of lines) clips[l.id] = wavDurationMs(readFileSync(clipFile.get(l.id)!));

  // 3. The take.
  const take = await recordTake(script, join(outFolder, "take"), helper, takeMonitor(options.monitor), log);
  writeFileSync(join(outFolder, "take-log.json"), JSON.stringify(take, null, 2));

  // 4. The timeline.
  const timeline = buildTimeline({ script, take, clips, fps: FPS, paces: settings.paces });
  writeFileSync(join(outFolder, "timeline.json"), JSON.stringify(timeline));
  log(`The video will be ${(timeline.durationMs / 1000).toFixed(1)} seconds (${timeline.frames} frames).`);

  // 5. Captions, transcript, chapters.
  const captions = makeCaptions(timeline.cues);
  writeFileSync(join(outFolder, "captions.srt"), toSrt(captions));
  writeFileSync(join(outFolder, "captions.vtt"), toVtt(captions));
  const targets = script.steps.map((_, i) => take.steps.find((s) => s.index === i)?.target);
  writeFileSync(join(outFolder, "transcript.txt"), makeTranscript(script, timeline, targets));
  const chapters = makeChapters(script, timeline);
  writeFileSync(join(outFolder, "chapters.txt"), chapters.text);
  chapters.warnings.forEach((w) => log(`Note: ${w}`));

  // 6. Assemble, with any blurred boxes chosen in review.
  const plan = { ...makePlan(timeline, outFolder, clipFile), redactions: redactionSpans(script, timeline) };
  if (plan.redactions.length) log(`Blurring ${script.redactions!.length} box(es) chosen in review.`);
  const planFile = join(outFolder, "plan.json");
  writeFileSync(planFile, JSON.stringify(plan));
  const video = join(outFolder, `${basename(scriptPath, ".json")}.mp4`);
  let lastShown = -1;
  const events = await runHelper(helper, ["assemble", "--plan", planFile, "--out", video], (e) => {
    if (e.event === "progress") {
      const pct = Math.floor(((e.frame as number) / (e.frames as number)) * 10) * 10;
      if (pct !== lastShown) {
        lastShown = pct;
        log(`Assembling: ${pct} percent.`);
      }
    } else if (e.event === "warning" || e.event === "note") log(`Note: ${e.message}`);
  });
  const done = events.find((e) => e.event === "assembled")!;
  const made: MadeVideo = { folder: outFolder, video, timeline, take, frameDigest: String(done.frameDigest), soundDigest: (done.soundDigest as string) ?? null };
  const narration = engine === "kokoro" ? `computer generated (Kokoro voice ${settings.voice.voice})` : "computer generated (Windows voice)";

  // 7. The frame scan and the review it starts.
  if (options.frameScan !== false) {
    made.review = await frameScan(script, scriptPath, outFolder, video, take, timeline, blocklist, narration, scriptTexts(script).length, helper, log);
  }

  // 8. The thumbnail, and the publishing details as they stand now.
  await makeThumbnail(script, take, timeline, settings, outFolder, helper, log);
  writeFileSync(join(outFolder, "publish.json"), JSON.stringify(makeDraft(script, basename(scriptPath, ".json"), chapters.text, narration, settings.publish), null, 2) + "\n");

  writeFileSync(join(outFolder, "run-report.json"), JSON.stringify({
    script: relative(ROOT, scriptPath), scriptPath, video: basename(video), durationMs: timeline.durationMs, frames: timeline.frames,
    frameDigest: made.frameDigest, soundDigest: made.soundDigest, voice: settings.voice, narration,
    pictures: new Set(take.steps.flatMap((s) => [...s.changes, ...(s.hover ? [s.hover] : [])])).size + 1,
    ...(made.review ? { flags: made.review.flags.length, gate: gate(made.review).says } : {}),
  }, null, 2));
  log(`Done: ${video}`);
  if (made.review) log(`${gate(made.review).says} ${made.review.flags.length ? "Review the flags" : "Approve the video"} in OpenStage Studio (Review Video.bat) before exporting it.`);
  return made;
}

/** A fingerprint of a whole file. */
export function fileDigest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Who wrote the script, in words, for the guard report. */
function writer(script: Script): string {
  const w = script.writtenBy;
  if (!w) return "not recorded";
  if (w.kind === "person") return `a person${w.name ? ` (${w.name})` : ""}`;
  return `an AI model${w.name ? ` (${w.name})` : ""}, ${w.editedByPerson ? "edited by a person" : "not edited by a person"}`;
}

async function frameScan(script: Script, scriptPath: string, outFolder: string, video: string, take: TakeLog, timeline: Timeline, blocklist: LoadedBlocklist, narration: string, scriptChecked: number, helper: string, log: (s: string) => void): Promise<Review> {
  const pictures = [...new Set(timeline.segments.flatMap((s) => (s.picture ? [s.picture] : [])))];
  log(`The frame scan: reading the text in ${pictures.length} pictures.`);
  const jobsFile = join(outFolder, "ocr-jobs.json");
  const ocrFile = join(outFolder, "ocr.json");
  writeFileSync(jobsFile, JSON.stringify({ pictures: pictures.map((id) => ({ id, file: join(outFolder, "take", `${id}.png`) })), out: ocrFile, language: "en-US" }));
  let lastShown = -1;
  await runHelper(helper, ["ocr", "--jobs", jobsFile], (e) => {
    if (e.event !== "progress") return;
    const pct = Math.floor(((e.done as number) / (e.of as number)) * 4) * 25;
    if (pct !== lastShown) {
      lastShown = pct;
      log(`Reading: ${pct} percent.`);
    }
  });
  const read = JSON.parse(readFileSync(ocrFile, "utf8")) as { language: string; pictures: OcrResult };
  const flags = scanFrames({ script, take, timeline, ocr: read.pictures, list: blocklist.list });
  const reviewFile = join(outFolder, "review.json");
  let earlier: Review | null = null;
  if (existsSync(reviewFile)) {
    try {
      earlier = JSON.parse(readFileSync(reviewFile, "utf8")) as Review;
    } catch {
      earlier = null;
    }
  }
  const fresh: Review = {
    format: REVIEW_FORMAT, version: 1, video: basename(video), videoDigest: fileDigest(video), script: scriptPath, title: script.title, fps: timeline.fps,
    narration, writtenBy: writer(script),
    scans: {
      script: { ran: true, checked: scriptChecked, hits: 0 },
      frames: { ran: true, pictures: pictures.length, read: `Windows' text recognition (${read.language})`, pageText: !!take.pageText },
      blocklist: { terms: blocklist.list.terms.length, patterns: blocklist.list.patterns, files: blocklist.files },
    },
    flags,
    decisions: {},
  };
  const review = carryDecisions(fresh, earlier);
  writeFileSync(reviewFile, JSON.stringify(review, null, 2));
  writeFileSync(join(outFolder, "guard-report.txt"), guardReport(review));
  const blurred = flags.filter((f) => f.covered).length;
  const carried = Object.keys(review.decisions).length;
  log(`The frame scan raised ${flags.length} flag${flags.length === 1 ? "" : "s"}${blurred ? ` (${blurred} already blurred)` : ""}${carried ? `; ${carried} decision(s) carried over from the last review of the same pictures` : ""}.`);
  for (const f of flags) log(`  Flag ${f.id}: ${f.how === "pattern" ? `${f.term}, "${f.found}"` : `"${f.term}"`} at ${(f.shown[0][0] / timeline.fps).toFixed(1)} seconds${f.covered ? " (blurred)" : ""}.`);
  return review;
}

async function makeThumbnail(script: Script, take: TakeLog, timeline: Timeline, settings: ProjectSettings, outFolder: string, helper: string, log: (s: string) => void) {
  // The chosen step's last picture (or the last step's), centred on the control it acted on.
  const index = (script.publish?.thumbnailStep ?? script.steps.length) - 1;
  const step = take.steps.find((s) => s.index === index);
  const picture = step ? (step.changes[step.changes.length - 1] ?? step.hover ?? take.start) : take.start;
  const r = step?.target?.rect ?? step?.callout?.rect;
  const focus: [number, number] | null = r ? [r[0] + r[2] / 2, r[1] + r[3] / 2] : null;
  // Any blurred box over that picture where it shows in the video is on the thumbnail too.
  const at = timeline.segments.filter((s) => s.picture === picture);
  const boxes = redactionSpans(script, timeline).filter((sp) => at.some((s) => sp.from < s.to && sp.to > s.from)).map((sp) => sp.box);
  const { plan, warnings } = thumbnailPlan(script, settings.publish?.thumbnail, join(outFolder, "take", `${picture}.png`), focus, boxes);
  warnings.forEach((w) => log(`Note: ${w}`));
  const planFile = join(outFolder, "thumbnail-plan.json");
  writeFileSync(planFile, JSON.stringify(plan, null, 2));
  await runHelper(helper, ["thumbnail", "--plan", planFile, "--out", join(outFolder, "thumbnail.png")], (e) => e.event === "warning" && log(`Note: ${e.message}`));
  log("Made the thumbnail.");
}

async function recordTake(script: Script, pictureDir: string, helper: string, monitor: number, log: (s: string) => void): Promise<TakeLog> {
  const program = findProgram(script.program.id);
  const server = new HookServer();
  await server.start();
  const launch = program.launch(ROOT, server.endpoint, server.token, monitor);
  log(`Starting ${program.name} in demo mode.`);
  const app = spawn(launch.exe, launch.args, { stdio: "ignore", windowsHide: false });
  let session: TakeSession | null = null;
  try {
    await Promise.race([
      server.contacted,
      new Promise((_, fail) => setTimeout(() => fail(new Error(`${program.name} did not start its demo-mode hook within 40 seconds.`)), 40000)),
    ]);
    session = new TakeSession(helper, program.windowTitle, FRAME);
    const ready = await session.ready();
    log(`Recording the window "${ready.window}" (${ready.windowWidth} by ${ready.windowHeight}).`);
    // A program that has just opened is still settling for a few seconds (its layout size is set as it opens, and it draws
    // some of its controls twice), so the take waits before the first step. Without this, two takes could differ.
    log("Letting the program finish starting.");
    await new Promise((r) => setTimeout(r, WARM_UP_MS));
    const s = session;
    const take = await play(script, server, { grab: async () => (await s.grab(pictureDir)).hash }, { frame: FRAME, log });
    return take;
  } finally {
    await session?.stop().catch(() => session?.kill());
    await server.close();
    app.kill();
  }
}

/** Turn the timeline into the helper's plan: picture files, cards, pointer, clicks, callouts and narration clips. */
function makePlan(timeline: Timeline, outFolder: string, clipFile: Map<string, string>) {
  const pictureDir = join(outFolder, "take");
  const pictures: Record<string, string> = {};
  for (const s of timeline.segments) if (s.picture) pictures[s.picture] = relative(outFolder, join(pictureDir, `${s.picture}.png`));
  return {
    width: timeline.width,
    height: timeline.height,
    fps: timeline.fps,
    bitrateKbps: 10000,
    frames: timeline.frames,
    pictures,
    segments: timeline.segments,
    pointer: timeline.pointer,
    pointerScale: 2 * (timeline.height / 1080),
    clicks: timeline.clicks,
    marks: timeline.marks,
    audio: { sampleRate: 48000, clips: timeline.clips.map((c) => ({ file: clipFile.get(c.id)!, startMs: c.startMs })) },
  };
}

// Run from the command line.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const scriptArg = args.find((a) => !a.startsWith("--"));
  const value = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (!scriptArg) {
    console.error("Say which script to make a video of.");
    process.exit(2);
  }
  const scriptPath = resolve(scriptArg);
  const out = resolve(value("--out") ?? join(ROOT, "renders", basename(scriptPath, ".json")));
  const blocklists = args.flatMap((a, i) => (a === "--blocklist" && args[i + 1] ? [args[i + 1]] : []));
  makeVideo(scriptPath, out, { monitor: takeMonitor(value("--monitor")), blocklists }).catch((e) => {
    console.error(`\nThe video was not made: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(e instanceof ScriptBlocked ? 3 : 1);
  });
}
