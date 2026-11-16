// Make Lecture.bat: a lecture script (src/lecture/format.ts) becomes a video. Its slides are drawn by Studio (the helper's
// `slides` command), one still picture each, and then everything is made exactly as for a tutorial (src/pipeline/
// make-video.ts): narration, the timeline, assembly to the MP4, captions, the description track, the transcript, the
// chapters, the frame scan and its review, the thumbnail and the publishing details. A lecture the AI wrote is made only
// once a person has approved it.
//
// node src/lecture/make-lecture.ts <lecture.json>

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { helperPath, runHelper } from "../pipeline/helper.ts";
import { makeVideo, ScriptBlocked, type MadeVideo } from "../pipeline/make-video.ts";
import { LECTURE_PROGRAM, type TakeLog } from "../timeline/build.ts";
import { SCRIPT_VERSION, type Script } from "../script/format.ts";
import { workspace } from "../paths.ts";
import { isMain } from "../util/is-main.ts";
import type { Lecture, Slide } from "./format.ts";
import { approvalState } from "./approval.ts";
import { describeLectureCheck, validateLecture } from "./validate.ts";

const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** What a slide shows, for the description track: its title, its points, what its picture shows, the author's words. */
export function slideDescription(s: Slide, n: number): string {
  const parts = [`Slide ${n}: ${sentence(s.title)}`];
  if (s.points?.length) parts.push(`Points: ${s.points.map((p) => p.trim().replace(/[.;]$/, "")).join("; ")}.`);
  if (s.pictureAlt) parts.push(`Picture: ${sentence(s.pictureAlt)}`);
  if (s.describe) parts.push(sentence(s.describe));
  return parts.join(" ");
}

/** The lecture as a tutorial-shaped script: one "wait" step per slide, so the timeline shows each slide for its narration. */
export function lectureToScript(l: Lecture): Script {
  return {
    format: "openstage-studio-script", version: SCRIPT_VERSION, title: l.title, goal: l.goal,
    program: { id: LECTURE_PROGRAM, name: l.course ?? "Lecture" },
    startState: { demoProject: "none", note: "A lecture: slides drawn by Studio, no program." },
    ...(l.playlist ? { playlist: l.playlist } : {}),
    ...(l.intro ? { intro: l.intro } : {}),
    ...(l.outro ? { outro: l.outro } : {}),
    ...(l.writtenBy ? { writtenBy: l.writtenBy } : {}),
    ...(l.publish ? { publish: l.publish } : {}),
    ...(l.redactions ? { redactions: l.redactions } : {}),
    steps: l.slides.map((s, i) => ({
      action: "wait" as const, value: "0", narration: s.narration, describe: slideDescription(s, i + 1),
      ...(s.chapter ? { chapter: s.chapter } : {}), ...(s.hold !== undefined ? { hold: s.hold } : {}),
    })),
  };
}

/** Draw the slides into `dir` and say which picture each one is, as a take would. */
export async function drawSlides(l: Lecture, lectureFile: string, dir: string, log: (s: string) => void): Promise<TakeLog> {
  const folder = dirname(resolve(lectureFile));
  const planFile = join(dir, "..", "slides-plan.json");
  const slides = l.slides.map((s, i) => {
    const picture = s.picture ? join(folder, s.picture) : undefined;
    if (picture && !existsSync(picture)) throw new Error(`Slide ${i + 1}: the picture ${s.picture} is not beside the lecture (${folder}).`);
    return { kicker: l.course ?? "", title: s.title, points: s.points ?? [], ...(picture ? { picture } : {}), number: i + 1, total: l.slides.length };
  });
  writeFileSync(planFile, JSON.stringify({ width: 1920, height: 1080, out: dir, slides }, null, 2));
  log(`Drawing ${slides.length} slide${slides.length === 1 ? "" : "s"}.`);
  const events = await runHelper(helperPath(), ["slides", "--plan", planFile], (e) => e.event === "warning" && log(`Note: ${e.message}`));
  const files = (events.find((e) => e.event === "slides")?.files ?? []) as { number: number; hash: string }[];
  if (files.length !== slides.length) throw new Error("The slides were not all drawn.");
  return { width: 1920, height: 1080, start: files[0].hash, steps: files.map((f, i) => ({ index: i, changes: [f.hash] })) };
}

/** Check a lecture file and say whether it may be made into a video, in words. */
export function readLecture(file: string): { lecture: Lecture; problems: string[]; approved: { ok: boolean; says: string } } {
  const c = validateLecture(JSON.parse(readFileSync(file, "utf8")));
  const problems = describeLectureCheck(c);
  if (!c.ok || !c.lecture) return { lecture: JSON.parse(readFileSync(file, "utf8")) as Lecture, problems, approved: { ok: false, says: "It does not pass the check." } };
  return { lecture: c.lecture, problems, approved: approvalState(c.lecture) };
}

export async function makeLecture(file: string, o: { outFolder?: string; log?: (s: string) => void; frameScan?: boolean; clipDir?: string } = {}): Promise<MadeVideo> {
  const log = o.log ?? console.log;
  const lectureFile = resolve(file);
  const { lecture, problems, approved } = readLecture(lectureFile);
  problems.forEach((p) => log(p));
  if (problems.some((p) => p.startsWith("Error"))) throw new Error(`The lecture has errors and was not made into a video.`);
  if (!approved.ok) throw new Error(`${approved.says} Approve it on Studio's Lecture page, then make the video.`);
  log(approved.says);
  const out = o.outFolder ?? join(workspace(), "renders", basename(lectureFile, ".json"));
  return makeVideo(lectureFile, out, {
    log, ...(o.frameScan !== undefined ? { frameScan: o.frameScan } : {}), ...(o.clipDir ? { clipDir: o.clipDir } : {}),
    prepared: { script: lectureToScript(lecture), scanned: lecture as unknown as Record<string, unknown>, take: (dir) => drawSlides(lecture, lectureFile, dir, log) },
  });
}

if (isMain(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error("Say which lecture to make into a video.");
    process.exit(2);
  }
  makeLecture(file).catch((e) => {
    console.error(`\nThe video was not made: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(e instanceof ScriptBlocked ? 3 : 1);
  });
}
