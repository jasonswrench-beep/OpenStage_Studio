// The frame scan: reads the text in every picture of the take and checks it against the blocklist. Text is read two ways
// and both are checked: from the picture itself (Windows' text recognition, which sees everything on screen, including
// images and the program's own dialogs) and, where the program's hook can say, from the page (exact, so a misread name
// is still caught). Each blocked thing found becomes one flag, with every frame it shows on, for a person to review.

import type { Rect, TakeLog, Timeline } from "../timeline/build.ts";
import type { Script } from "../script/format.ts";
import { findHits, type Blocklist, type Category, type Hit } from "./blocklist.ts";
import { inside, redactionSpans, stepsAt, wordSpans, type RedactionSpan } from "./redact.ts";

/** What the helper's `ocr` command found in one picture. */
export interface OcrLine {
  text: string;
  rect: Rect;
  words: { text: string; rect: Rect }[];
}
export type OcrResult = Record<string, OcrLine[]>;

/** One place a blocked thing was seen. */
export interface Sighting {
  picture: string;
  /** Read from the picture, or reported by the program's page. */
  source: "picture" | "page";
  /** The line of text it was in. */
  text: string;
  found: string;
  how: Hit["how"];
  rect: Rect;
}

export interface Flag {
  /** Stable for the same pictures: the same take gives the same ids, so earlier decisions carry over. */
  id: string;
  term: string;
  category: Category;
  note?: string;
  /** The words as seen most often. */
  found: string;
  how: Hit["how"];
  /** Where on the picture, in pixels of the 1920 by 1080 video. */
  rect: Rect;
  /** The frames it shows on, as ranges (first frame, frame after the last). */
  shown: [number, number][];
  /** The steps it shows in (counting from 1; 0 is the starting picture). */
  steps: [number, number];
  /** Every picture it was seen in, and how. */
  sightings: Sighting[];
  /** Whether a blurred box in the script covers it on every frame it shows. */
  covered: boolean;
}

/** A short, stable fingerprint of some text (FNV-1a, 32 bits, as 8 hex digits). */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const union = (rects: Rect[]): Rect => {
  const l = Math.min(...rects.map((r) => r[0])), t = Math.min(...rects.map((r) => r[1]));
  const r = Math.max(...rects.map((q) => q[0] + q[2])), b = Math.max(...rects.map((q) => q[1] + q[3]));
  return [l, t, r - l, b - t];
};

/** How much two boxes overlap, as a share of the smaller one. */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, Math.min(a[2] * a[3], b[2] * b[3]));
}

/** The hits in one line read from a picture, each placed on the words it covers. */
function pictureHits(picture: string, line: OcrLine, list: Blocklist): Sighting[] {
  // Rebuild the line from its words, keeping where each word starts, so a hit can be placed on its words.
  let text = "";
  const at: { from: number; to: number; rect: Rect }[] = [];
  for (const w of line.words) {
    if (text) text += " ";
    at.push({ from: text.length, to: text.length + w.text.length, rect: w.rect });
    text += w.text;
  }
  return findHits(text, list).map((h) => {
    const words = at.filter((w) => w.from < h.end && w.to > h.start);
    return { picture, source: "picture" as const, text, found: h.found, how: h.how, rect: union(words.length ? words.map((w) => w.rect) : [line.rect]), term: h.term, category: h.category, note: h.note };
  });
}

/** The hits in one piece of text the page reported. A single line is cut down to the part with the hit. */
function pageHits(picture: string, item: { text: string; rect: Rect }, list: Blocklist): Sighting[] {
  return findHits(item.text, list).map((h) => {
    const [x, y, w, hgt] = item.rect;
    const oneLine = hgt < 48 && item.text.length > 0;
    const rect: Rect = oneLine
      ? [Math.round(x + (w * h.start) / item.text.length), y, Math.max(1, Math.round((w * (h.end - h.start)) / item.text.length)), hgt]
      : item.rect;
    return { picture, source: "page" as const, text: item.text, found: h.found, how: h.how, rect, term: h.term, category: h.category, note: h.note };
  });
}

/** Whether boxes cover a rectangle on every frame from `from` to `to`. */
function coveredOn(rect: Rect, from: number, to: number, spans: RedactionSpan[]): boolean {
  const ranges = spans.filter((s) => inside(rect, s.box) && s.to > from && s.from < to).map((s) => [Math.max(from, s.from), Math.min(to, s.to)]).sort((a, b) => a[0] - b[0]);
  let reached = from;
  for (const [a, b] of ranges) {
    if (a > reached) return false;
    reached = Math.max(reached, b);
  }
  return reached >= to;
}

export interface FrameScanInput {
  script: Script;
  take: TakeLog;
  timeline: Timeline;
  ocr: OcrResult;
  list: Blocklist;
  /** The project's words that are blurred wherever the program shows them. */
  blur?: string[];
}

export function scanFrames({ script, take, timeline, ocr, list, blur }: FrameScanInput): Flag[] {
  // Where each picture shows.
  const shownAt = new Map<string, [number, number][]>();
  for (const s of timeline.segments) if (s.picture) shownAt.set(s.picture, [...(shownAt.get(s.picture) ?? []), [s.from, s.to]]);

  // Every sighting, in pictures that are actually in the video.
  type Found = Sighting & { term: string; category: Category; note?: string };
  const found: Found[] = [];
  const cache = new Map<string, Hit[]>();
  const hitsIn = (text: string) => {
    if (!cache.has(text)) cache.set(text, findHits(text, list));
    return cache.get(text)!;
  };
  for (const picture of shownAt.keys()) {
    for (const line of ocr[picture] ?? []) {
      if (!hitsIn(line.words.map((w) => w.text).join(" ")).length) continue;
      found.push(...(pictureHits(picture, line, list) as Found[]));
    }
    for (const item of take.pageText?.[picture] ?? []) {
      if (!hitsIn(item.text).length) continue;
      found.push(...(pageHits(picture, item, list) as Found[]));
    }
  }

  // One flag for each blocked thing in one place: sightings of the same term whose boxes overlap.
  const groups: Found[][] = [];
  const firstShown = (p: string) => shownAt.get(p)?.[0]?.[0] ?? 0;
  for (const f of found.sort((a, b) => firstShown(a.picture) - firstShown(b.picture) || a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0])) {
    const g = groups.find((g) => g[0].term === f.term && g.some((o) => overlap(o.rect, f.rect) > 0.5));
    if (g) g.push(f);
    else groups.push([f]);
  }

  const spans = [...redactionSpans(script, timeline), ...wordSpans(blur ?? [], take, timeline)];
  return groups.map((g) => {
    const fromPictures = g.filter((s) => s.source === "picture");
    const rect = union((fromPictures.length ? fromPictures : g).map((s) => s.rect));
    const pictures = [...new Set(g.map((s) => s.picture))];
    const shown = mergeRanges(pictures.flatMap((p) => shownAt.get(p) ?? []));
    const counts = new Map<string, number>();
    for (const s of g) counts.set(s.found, (counts.get(s.found) ?? 0) + 1);
    const commonest = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const how = (["exact", "pattern", "close", "partial"] as const).find((h) => g.some((s) => s.how === h)) ?? g[0].how;
    // Covered if, in every picture it is in, the place it was read from the picture (or, where only the program reported
    // it, the place the program gave) is under a blurred box on every frame that picture shows.
    const covered = pictures.every((p) => {
      const inP = g.filter((s) => s.picture === p);
      const read = inP.filter((s) => s.source === "picture");
      return (read.length ? read : inP).every((s) => (shownAt.get(p) ?? []).every(([a, b]) => coveredOn(s.rect, a, b, spans)));
    });
    const steps = stepsAt(shown[0][0], shown[shown.length - 1][1], timeline);
    return {
      id: shortHash(`${g[0].term}|${rect.join(",")}|${pictures.sort().join(",")}`),
      term: g[0].term, category: g[0].category, ...(g[0].note ? { note: g[0].note } : {}),
      found: commonest, how, rect, shown, steps,
      sightings: g.map(({ picture, source, text, found, how, rect }) => ({ picture, source, text, found, how, rect })),
      covered,
    };
  });
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...ranges].sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** A frame as a time in the video, such as 1:23.4. */
export function timeOf(frame: number, fps: number): string {
  const s = frame / fps;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}
