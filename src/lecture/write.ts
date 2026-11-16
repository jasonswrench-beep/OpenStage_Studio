// Write Lecture.bat: notes, or one chapter of a manual, become a lecture script (src/lecture/format.ts) that a person
// reads, edits and approves before the video is made.
//
// With no AI, fixed rules make the draft: in notes, a "# " line is the lecture's title, each "## " line starts a slide,
// list items are its points and the paragraphs under it are what is said; a manual's chapter gives one slide per topic,
// with its numbered steps as points. With an AI chosen (Set Up AI), the AI writes the slides and narration from the same
// text, and Studio checks every answer (the format, the limits, the blocklist) and sends it back with the problems in
// words until it passes. Either way the lecture waits for a person's approval.
//
// node src/lecture/write.ts <notes.md | notes.txt | manual> [--chapter <number or words>] [--no-ai]
// node src/lecture/write.ts --approve <lecture.json> --by <your name>

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { askChecked, NEVER, slug } from "../ai/roles.ts";
import { openAnswerer, type Answerer } from "../ai/ask.ts";
import { describeChoice, readAiSettings } from "../ai/settings.ts";
import { importManual } from "../manual/import.ts";
import { findChapter, type Chapter } from "../manual/manual.ts";
import { loadBlocklist } from "../guard/load.ts";
import { describeScriptHit, scanScript } from "../guard/script-scan.ts";
import { workspace } from "../paths.ts";
import { isMain } from "../util/is-main.ts";
import { LECTURE_FORMAT, LECTURE_VERSION, type Lecture, type Slide } from "./format.ts";
import { approve } from "./approval.ts";
import { validateLecture } from "./validate.ts";

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);
const plain = (s: string) => s.replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

/** Paragraphs as narration, cut at a sentence end so a slide's narration stays within its limit. */
function narrationFrom(paragraphs: string[], fallback: string): string {
  let text = paragraphs.map(plain).filter(Boolean).join(" ");
  if (!text) text = fallback;
  if (text.length <= 1200) return text;
  const cut = text.slice(0, 1200);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > 200 ? cut.slice(0, end + 1) : `${cut.slice(0, 1199)}…`;
}

/** Points, at most six of at most 100 characters each; any more go on a following slide. */
function slidesFor(title: string, points: string[], paragraphs: string[], chapter?: string): Slide[] {
  const out: Slide[] = [];
  const pts = points.map((p) => clip(plain(p), 100)).filter(Boolean);
  for (let k = 0; k === 0 || k < pts.length; k += 6) {
    const these = pts.slice(k, k + 6);
    const t = clip(plain(k === 0 ? title : `${title} (continued)`), 80);
    out.push({
      title: t, ...(these.length ? { points: these } : {}),
      narration: k === 0 ? narrationFrom(paragraphs, these.length ? these.join(". ") : t) : these.join(". ").replace(/([^.!?])$/, "$1."),
      ...(k === 0 && chapter ? { chapter } : {}),
    });
  }
  return out;
}

/** Notes (Markdown or plain text) as a lecture, by fixed rules. */
export function notesToLecture(text: string, o: { title?: string; file?: string } = {}): Lecture {
  let title = o.title ?? "";
  const slides: Slide[] = [];
  let cur: { title: string; points: string[]; paragraphs: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length && cur) cur.paragraphs.push(para.join(" "));
    para = [];
  };
  const flush = () => {
    flushPara();
    if (cur) slides.push(...slidesFor(cur.title, cur.points, cur.paragraphs));
    cur = null;
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h && h[1].length === 1 && !title) {
      title = plain(h[2]);
      continue;
    }
    if (h) {
      flush();
      cur = { title: h[2], points: [], paragraphs: [] };
      continue;
    }
    const item = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      cur ??= { title: title || "Introduction", points: [], paragraphs: [] };
      cur.points.push(item[1]);
      continue;
    }
    if (!line) {
      flushPara();
      continue;
    }
    cur ??= { title: title || "Introduction", points: [], paragraphs: [] };
    para.push(line);
  }
  flush();
  if (!slides.length) throw new Error("The notes have nothing to make slides from.");
  const t = clip(title || slides[0].title, 100);
  return {
    format: LECTURE_FORMAT, version: LECTURE_VERSION, title: t, goal: `You understand ${t.charAt(0).toLowerCase()}${t.slice(1)}.`,
    ...(o.file ? { source: { kind: "notes" as const, file: o.file } } : {}),
    writtenBy: { kind: "person", name: "Studio, from your notes", editedByPerson: false },
    slides: slides.slice(0, 100),
  };
}

/** One chapter of a manual as a lecture, by fixed rules: one slide per topic, its numbered steps as points. */
export function chapterToLecture(manualTitle: string, chapter: Chapter, file?: string): Lecture {
  const slides: Slide[] = [];
  for (const t of chapter.topics) {
    const steps = t.procedures.flat().map((s) => s.text);
    const paragraphs = t.text.split(/\n{2,}|\n/).map((p) => p.trim()).filter((p) => p && !/^\d+[.)]/.test(p));
    slides.push(...slidesFor(t.depth === 0 ? chapter.title : t.title, steps, paragraphs, t.depth === 1 ? clip(plain(t.title), 80) : undefined));
  }
  if (!slides.length) throw new Error(`The chapter "${chapter.title}" has nothing to make slides from.`);
  return {
    format: LECTURE_FORMAT, version: LECTURE_VERSION, title: clip(plain(chapter.title), 100), goal: `You understand ${plain(chapter.title).toLowerCase()}, from ${manualTitle}.`,
    course: clip(plain(manualTitle), 60),
    ...(file ? { source: { kind: "manual" as const, file, chapter: chapter.title } } : {}),
    writtenBy: { kind: "person", name: "Studio, from the manual", editedByPerson: false },
    slides: slides.slice(0, 100),
  };
}

const WRITER = `You turn teaching notes or a manual's chapter into a short narrated lecture: slides with spoken narration.
Each slide has a title (at most 60 characters), up to four short points (each at most 80 characters, not full sentences), and narration: what the presenter says while the slide shows, two to five plain sentences that explain the points rather than read them out.
Keep the source's meaning and order; do not add facts the source does not give. Start with a slide that says what the lecture covers.
${NEVER}
Answer with JSON only, in this shape:
{"title": "...", "goal": "one sentence: what the viewer understands after watching", "intro": "one or two sentences said over the title card", "outro": "one sentence said over the end card", "slides": [{"title": "...", "points": ["..."], "narration": "...", "chapter": "optional: starts a chapter here"}]}`;

/** The AI writes the lecture from the source's words; Studio checks it and sends it back until it passes. */
export async function writeLectureWithAi(a: Answerer, sourceText: string, draft: Lecture): Promise<{ lecture: Lecture; rounds: number }> {
  const list = loadBlocklist(workspace()).list;
  const user = `The lecture's working title: ${draft.title}.${draft.course ? ` Course: ${draft.course}.` : ""}\n\nThe source:\n${sourceText.slice(0, 60000)}`;
  const { value, rounds } = await askChecked<Lecture>(a, WRITER, user, (v) => {
    const o = (v ?? {}) as Record<string, unknown>;
    const slides = Array.isArray(o.slides) ? o.slides.map((s) => {
      const x = (s ?? {}) as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of ["title", "points", "narration", "chapter", "describe"]) if (x[k] !== undefined && x[k] !== null && x[k] !== "") out[k] = x[k];
      return out;
    }) : o.slides;
    const lecture = {
      format: LECTURE_FORMAT, version: LECTURE_VERSION, title: o.title, goal: o.goal,
      ...(draft.course ? { course: draft.course } : {}),
      ...(typeof o.intro === "string" && o.intro.trim() ? { intro: o.intro } : {}),
      ...(typeof o.outro === "string" && o.outro.trim() ? { outro: o.outro } : {}),
      ...(draft.source ? { source: draft.source } : {}),
      writtenBy: { kind: "model", name: a.name, editedByPerson: false },
      slides,
    };
    const c = validateLecture(lecture);
    const problems = c.errors.map((e) => `${e.path}: ${e.message}`);
    if (c.ok) problems.push(...scanScript(lecture as unknown as Record<string, unknown>, list).map(describeScriptHit));
    return { value: problems.length ? undefined : (lecture as unknown as Lecture), problems };
  }, 4, 12000);
  return { lecture: value, rounds };
}

export interface Written {
  file: string;
  lecture: Lecture;
  ai: string;
  warnings: string[];
}

/** Notes or a manual's chapter become a lecture file in the work folder's `lectures` folder (never written over). */
export async function writeLecture(source: string, o: { chapter?: string; useAi?: boolean; title?: string; log?: (s: string) => void; outFolder?: string } = {}): Promise<Written> {
  const log = o.log ?? console.log;
  const file = resolve(source);
  if (!existsSync(file)) throw new Error(`${file} does not exist.`);
  const ext = extname(file).toLowerCase();
  let draft: Lecture;
  let sourceText: string;
  if (ext === ".md" || ext === ".txt" || ext === ".markdown") {
    sourceText = readFileSync(file, "utf8");
    draft = notesToLecture(sourceText, { file, ...(o.title ? { title: o.title } : {}) });
  } else {
    const manual = await importManual(file);
    const chapter = findChapter(manual, o.chapter);
    draft = chapterToLecture(manual.title, chapter, file);
    sourceText = chapter.topics.map((t) => `${t.title}\n${t.text}`).join("\n\n");
  }
  log(`From ${basename(file)}: ${draft.slides.length} slide${draft.slides.length === 1 ? "" : "s"} by Studio's rules.`);
  let lecture = draft;
  let ai = "no AI (Studio's fixed rules)";
  const settings = readAiSettings();
  if (o.useAi !== false && settings.choice !== "none") {
    log(`Writing the lecture with ${describeChoice(settings)}.`);
    const a = await openAnswerer(settings, log);
    try {
      const r = await writeLectureWithAi(a, sourceText, draft);
      lecture = r.lecture;
      ai = a.name;
      log(`The AI's lecture passed the checks after ${r.rounds} round${r.rounds === 1 ? "" : "s"}: ${lecture.slides.length} slides.`);
    } finally {
      await a.close();
    }
  }
  const check = validateLecture(lecture);
  if (!check.ok) throw new Error(`The lecture does not pass the check: ${check.errors.map((e) => `${e.path}: ${e.message}`).join(" ")}`);
  const folder = o.outFolder ?? join(workspace(), "lectures");
  mkdirSync(folder, { recursive: true });
  let out = "";
  for (let n = 1; ; n++) {
    out = join(folder, `${slug(lecture.title)}${n === 1 ? "" : `-${n}`}.json`);
    if (!existsSync(out)) break;
  }
  writeFileSync(out, JSON.stringify(lecture, null, 2) + "\n");
  log(`The lecture is ${out}. Read it and change what you like, then approve it on Studio's Lecture page (or with Approve Lecture.bat).`);
  return { file: out, lecture, ai, warnings: check.warnings.map((w) => `${w.path}: ${w.message}`) };
}

/** A person approves a lecture file as it stands now. */
export function approveLecture(file: string, by: string, at = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })): Lecture {
  const c = validateLecture(JSON.parse(readFileSync(file, "utf8")));
  if (!c.ok || !c.lecture) throw new Error(`It does not pass the check, so it cannot be approved: ${c.errors.map((e) => `${e.path}: ${e.message}`).join(" ")}`);
  const approved = approve(c.lecture, by, at);
  writeFileSync(file, JSON.stringify(approved, null, 2) + "\n");
  return approved;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const fail = (e: unknown) => {
    console.error(`\nThat did not finish: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  };
  if (args.includes("--approve")) {
    const file = value("--approve");
    const by = value("--by");
    if (!file || !by) {
      console.error('Say which lecture and who approves it: --approve <lecture.json> --by "<your name>".');
      process.exit(2);
    }
    try {
      const l = approveLecture(resolve(file), by);
      console.log(`Approved by ${l.approval!.by}. Any change to its words needs a new approval.`);
    } catch (e) {
      fail(e);
    }
  } else {
    const source = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--chapter"));
    if (!source) {
      console.error("Say which notes (.md or .txt) or manual to write a lecture from.");
      process.exit(2);
    }
    writeLecture(source, { chapter: value("--chapter"), useAi: !args.includes("--no-ai") }).catch(fail);
  }
}
