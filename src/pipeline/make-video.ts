// Makes one video from one script, from start to finish:
//
//   1. check the script against the format
//   2. make the narration, one clip per line (clips already made are reused)
//   3. the take: start the program in demo mode and perform the script, saving a still picture after every change
//   4. build the timeline from the narration's lengths
//   5. write the captions (SRT and VTT), the transcript and the chapter list
//   6. assemble the finished MP4 (1920 by 1080, 30 frames a second)
//
// node src/pipeline/make-video.ts <script.json> [--out <folder>] [--monitor <n>]

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
}

export function readProjectSettings(scriptPath: string): ProjectSettings {
  const file = join(dirname(scriptPath), "studio-project.json");
  const settings: ProjectSettings = { voice: { ...DEFAULT_VOICE }, pronunciations: {} };
  if (!existsSync(file)) return settings;
  const data = JSON.parse(readFileSync(file, "utf8")) as Partial<ProjectSettings>;
  return { voice: { ...settings.voice, ...data.voice }, pronunciations: data.pronunciations ?? {}, paces: data.paces };
}

export interface MadeVideo {
  folder: string;
  video: string;
  timeline: Timeline;
  take: TakeLog;
  frameDigest: string;
  soundDigest: string | null;
}

const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 24);

export async function makeVideo(scriptPath: string, outFolder: string, options: { monitor?: number; log?: (s: string) => void; clipDir?: string } = {}): Promise<MadeVideo> {
  const log = options.log ?? ((s: string) => console.log(s));
  const helper = helperPath(ROOT);

  // 1. Check the script.
  const v = validateScript(JSON.parse(readFileSync(scriptPath, "utf8")));
  for (const line of describeProblems(v)) log(line);
  if (!v.ok) throw new Error(`The script has ${v.errors.length} error(s) and was not recorded.`);
  const script = v.script as Script;
  const settings = readProjectSettings(scriptPath);
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

  // 6. Assemble.
  const plan = makePlan(timeline, outFolder, clipFile);
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
  writeFileSync(join(outFolder, "run-report.json"), JSON.stringify({
    script: relative(ROOT, scriptPath), video: basename(video), durationMs: timeline.durationMs, frames: timeline.frames,
    frameDigest: made.frameDigest, soundDigest: made.soundDigest, voice: settings.voice, narration: engine === "kokoro" ? `computer generated (Kokoro voice ${settings.voice.voice})` : "computer generated (Windows voice)",
    pictures: new Set(take.steps.flatMap((s) => [...s.changes, ...(s.hover ? [s.hover] : [])])).size + 1,
  }, null, 2));
  log(`Done: ${video}`);
  return made;
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
  makeVideo(scriptPath, out, { monitor: takeMonitor(value("--monitor")) }).catch((e) => {
    console.error(`\nThe video was not made: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
