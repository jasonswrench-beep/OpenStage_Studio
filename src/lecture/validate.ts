// Checks a lecture script before anything is made from it (docs/lecture-format.md). Unknown fields are errors, so a
// misspelled one is caught. Fixed limits keep every slide readable at 1080p and every paragraph short enough to follow.

import { LECTURE_FORMAT, LECTURE_VERSION, type Lecture } from "./format.ts";

export interface LectureCheck {
  ok: boolean;
  errors: { path: string; message: string }[];
  warnings: { path: string; message: string }[];
  lecture?: Lecture;
}

const HEADER = ["format", "version", "title", "goal", "course", "playlist", "intro", "outro", "source", "writtenBy", "approval", "publish", "redactions", "slides"];
const SLIDE = ["title", "points", "picture", "pictureAlt", "narration", "describe", "chapter", "hold"];
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function validateLecture(input: unknown): LectureCheck {
  const errors: LectureCheck["errors"] = [];
  const warnings: LectureCheck["warnings"] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const warn = (path: string, message: string) => warnings.push({ path, message });
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    err("", "A lecture is a JSON object.");
    return { ok: false, errors, warnings };
  }
  const l = input as Record<string, unknown>;
  for (const k of Object.keys(l)) if (!HEADER.includes(k)) err(k, `"${k}" is not a lecture field.`);
  if (l.format !== LECTURE_FORMAT) err("format", `The format must be "${LECTURE_FORMAT}".`);
  if (l.version !== LECTURE_VERSION) {
    err("version", typeof l.version === "number" && l.version > LECTURE_VERSION ? `This lecture is version ${l.version}, made by a newer OpenStage Studio.` : `The version must be ${LECTURE_VERSION}.`);
  }
  const text = (key: string, max: number, required = false) => {
    const v = l[key];
    if (v === undefined) {
      if (required) err(key, `The lecture needs a ${key}.`);
    } else if (!isText(v)) err(key, `The ${key} is words.`);
    else if (v.length > max) err(key, `The ${key} is at most ${max} characters.`);
  };
  text("title", 100, true);
  text("goal", 300, true);
  text("course", 60);
  text("intro", 1200);
  text("outro", 1200);
  if (l.playlist !== undefined) {
    const p = l.playlist as Record<string, unknown>;
    if (!p || !isText(p.name) || !(Number.isInteger(p.position) && (p.position as number) >= 1)) err("playlist", 'A playlist is { "name": "...", "position": 1 }.');
  }
  if (l.writtenBy !== undefined) {
    const w = l.writtenBy as Record<string, unknown>;
    if (!w || (w.kind !== "person" && w.kind !== "model")) err("writtenBy.kind", "writtenBy.kind is person or model.");
  }
  if (l.approval !== undefined) {
    const a = l.approval as Record<string, unknown>;
    if (!a || !isText(a.by) || !isText(a.at) || typeof a.digest !== "string" || !/^[0-9a-f]{64}$/.test(a.digest)) err("approval", "An approval has the person's name (by), when (at) and the lecture's fingerprint (digest). Approve in Studio rather than by hand.");
  }
  const slides = l.slides;
  if (!Array.isArray(slides) || slides.length === 0) err("slides", "A lecture has at least one slide.");
  else if (slides.length > 100) err("slides", "A lecture has at most 100 slides; make a longer one into several videos.");
  else {
    slides.forEach((raw, i) => {
      const at = `slides[${i}]`;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return err(at, "A slide is a JSON object.");
      const s = raw as Record<string, unknown>;
      for (const k of Object.keys(s)) if (!SLIDE.includes(k)) err(`${at}.${k}`, `"${k}" is not a slide field.`);
      if (!isText(s.title)) err(`${at}.title`, "Every slide has a title.");
      else if (s.title.length > 80) err(`${at}.title`, "A slide's title is at most 80 characters.");
      else if (s.title.length > 60) warn(`${at}.title`, "A title over 60 characters takes two lines on the slide.");
      if (s.points !== undefined) {
        if (!Array.isArray(s.points) || s.points.some((p) => !isText(p))) err(`${at}.points`, "Points are a list of short sentences.");
        else {
          if (s.points.length > 6) err(`${at}.points`, "A slide has at most six points; split it into two slides.");
          else if (s.points.length > 4) warn(`${at}.points`, "More than four points make a crowded slide.");
          (s.points as string[]).forEach((p, k) => p.length > 100 && err(`${at}.points[${k}]`, "A point is at most 100 characters; say the rest in the narration."));
        }
      }
      if (s.picture !== undefined) {
        if (!isText(s.picture) || !/^[^\\/:*?"<>|]+\.png$/i.test(s.picture) || s.picture.includes("..")) err(`${at}.picture`, "A picture is the name of a PNG file beside the lecture, such as seed.png (never a path).");
        if (!isText(s.pictureAlt)) err(`${at}.pictureAlt`, "A slide with a picture says what the picture shows (pictureAlt), for viewers who cannot see it.");
      }
      if (s.pictureAlt !== undefined && s.picture === undefined) err(`${at}.pictureAlt`, "pictureAlt describes a picture; this slide has none.");
      if (isText(s.pictureAlt) && s.pictureAlt.length > 250) err(`${at}.pictureAlt`, "pictureAlt is at most 250 characters.");
      if (!isText(s.narration)) err(`${at}.narration`, "Every slide has narration: what is said while it shows.");
      else if (s.narration.length > 1200) err(`${at}.narration`, "A slide's narration is at most 1,200 characters; split it over two slides.");
      else if (s.narration.length > 700) warn(`${at}.narration`, "Long narration keeps one slide up for more than a minute; consider two slides.");
      if (s.describe !== undefined && (!isText(s.describe) || s.describe.length > 280)) err(`${at}.describe`, "describe is words, at most 280 characters.");
      if (s.chapter !== undefined && (!isText(s.chapter) || s.chapter.length > 80)) err(`${at}.chapter`, "A chapter has a name of at most 80 characters.");
      if (s.hold !== undefined && !(typeof s.hold === "number" && s.hold >= 0 && s.hold <= 10)) err(`${at}.hold`, "hold is a number of seconds from 0 to 10.");
    });
  }
  return { ok: errors.length === 0, errors, warnings, ...(errors.length === 0 ? { lecture: l as unknown as Lecture } : {}) };
}

/** The check's findings, one line each, for a person. */
export function describeLectureCheck(c: LectureCheck): string[] {
  return [...c.errors.map((e) => `Error at ${e.path || "the top"}: ${e.message}`), ...c.warnings.map((w) => `Warning at ${w.path}: ${w.message}`)];
}
