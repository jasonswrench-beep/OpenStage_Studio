// The timeline builder: lines up the take's pictures, the pointer, the clicks, the callouts, the cards and the narration.
//
// The take saves a still picture after every change on screen (see src/pipeline/player.ts), and the narration clips are
// made before it. This file decides when each picture shows. Nothing here reads a clock: every time comes from the
// narration's length and fixed paces, snapped to whole frames. That is what makes the same script give the same video.

import { parseKey, type Script, type Side, type Step } from "../script/format.ts";

export type Rect = [number, number, number, number];

/** What the player saw and saved for one step of the take. */
export interface TakeStep {
  index: number;
  /** The control acted on, in pixels of the frame, measured just before the action. */
  target?: { rect: Rect; label?: string; role?: string };
  /** The picture with the pointer resting over the control (the program's hover look), if the hook gave one. */
  hover?: string;
  /** A picture after each change the step made, in order: one for a click, one per character typed, and so on. */
  changes: string[];
  /** Where the callout's control is, in pixels of the frame. */
  callout?: { rect: Rect; label?: string };
}

export interface TakeLog {
  width: number;
  height: number;
  /** The picture of the starting state. */
  start: string;
  steps: TakeStep[];
  /** The text on screen at each picture, by picture, as the program reported it (in pixels of the frame). For the frame
   * scan only; the video does not use it. */
  pageText?: Record<string, { text: string; rect: Rect }[]>;
}

/** How long each narration clip lasts, in milliseconds, by its id: `intro`, `outro`, `step-<index>`. */
export type ClipLengths = Record<string, number>;

export interface Card {
  kicker?: string;
  title: string;
  lines?: string[];
}

export interface Segment {
  from: number;
  to: number;
  picture?: string;
  card?: Card;
  fadeIn?: number;
}

export interface Mark {
  kind: "box" | "arrow" | "label" | "key";
  from: number;
  to: number;
  rect?: Rect;
  start?: [number, number];
  end?: [number, number];
  text?: string;
  color?: string;
  background?: string;
  fontPx?: number;
}

export interface Cue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface StepTiming {
  index: number;
  startMs: number;
  endMs: number;
  /** When the action happened (the click, the first key, the cut to a new project). */
  actionMs: number;
  chapter?: string;
}

export interface Timeline {
  fps: number;
  width: number;
  height: number;
  frames: number;
  segments: Segment[];
  pointer: ([number, number] | null)[];
  clicks: { frame: number; x: number; y: number }[];
  marks: Mark[];
  cues: Cue[];
  clips: { id: string; startMs: number }[];
  steps: StepTiming[];
  durationMs: number;
}

/** The paces of a video, in milliseconds. Adjustable per project; these are the defaults. */
export interface Paces {
  titleMinMs: number;
  introLeadMs: number;
  endCardMinMs: number;
  fadeMs: number;
  stepGapMs: number;
  firstStepLeadMs: number;
  clickDwellMs: number;
  responseMs: number;
  typeCharMs: number;
  keyLeadMs: number;
  keyBadgeMs: number;
  scrollStepMs: number;
  afterActionMs: number;
  tailMs: number;
}

export const DEFAULT_PACES: Paces = {
  titleMinMs: 3000,
  introLeadMs: 500,
  endCardMinMs: 4000,
  fadeMs: 300,
  stepGapMs: 450,
  firstStepLeadMs: 600,
  clickDwellMs: 160,
  responseMs: 100,
  typeCharMs: 65,
  keyLeadMs: 500,
  keyBadgeMs: 1300,
  scrollStepMs: 90,
  afterActionMs: 400,
  tailMs: 700,
};

/** How long the pointer takes to travel `distance` pixels: quick for short moves, never rushed for long ones. */
export function travelMs(distance: number): number {
  return Math.round(Math.min(1300, Math.max(450, 350 + distance * 0.45)));
}

/** Smooth start and stop (cubic ease in and out), t from 0 to 1. */
export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** A gentle curve from `a` to `b`, the way a hand moves, rather than a straight ruler line. */
export function pointerAt(a: [number, number], b: [number, number], t: number): [number, number] {
  const e = ease(t);
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  // Bow the path a little to one side, more for longer moves, none at either end.
  const bow = Math.min(60, Math.hypot(dx, dy) * 0.08) * Math.sin(Math.PI * e);
  const len = Math.hypot(dx, dy) || 1;
  const [nx, ny] = [-dy / len, dx / len];
  return [Math.round((a[0] + dx * e + nx * bow) * 10) / 10, Math.round((a[1] + dy * e + ny * bow) * 10) / 10];
}

export const centre = (r: Rect): [number, number] => [Math.round(r[0] + r[2] / 2), Math.round(r[1] + r[3] / 2)];

export interface BuildInput {
  script: Script;
  take: TakeLog;
  clips: ClipLengths;
  fps?: number;
  paces?: Partial<Paces>;
}

export function buildTimeline(input: BuildInput): Timeline {
  const { script, take, clips } = input;
  const fps = input.fps ?? 30;
  const P: Paces = { ...DEFAULT_PACES, ...input.paces };
  const frame = (ms: number) => Math.round((ms * fps) / 1000);
  const { width, height } = take;
  const scale = height / 1080;

  const cues: Cue[] = [];
  const clipsOut: { id: string; startMs: number }[] = [];
  const pictureAt: { ms: number; picture: string; fade?: number }[] = [];
  const clicks: { ms: number; x: number; y: number }[] = [];
  const moves: { fromMs: number; toMs: number; a: [number, number]; b: [number, number] }[] = [];
  const marksMs: (Omit<Mark, "from" | "to"> & { fromMs: number; toMs: number })[] = [];
  const steps: StepTiming[] = [];

  const speak = (id: string, text: string | undefined, atMs: number): number => {
    const len = text ? clips[id] : undefined;
    if (text && len === undefined) throw new Error(`There is no narration clip for ${id}.`);
    if (!text || !len) return atMs;
    clipsOut.push({ id, startMs: atMs });
    cues.push({ id, startMs: atMs, endMs: atMs + len, text });
    return atMs + len;
  };

  // Title card, with the intro spoken over it.
  const introEnd = speak("intro", script.intro, P.introLeadMs);
  const titleEnd = Math.max(P.titleMinMs, script.intro ? introEnd + 600 : 0);
  pictureAt.push({ ms: titleEnd, picture: take.start, fade: P.fadeMs });

  let pointer: [number, number] = [Math.round(width / 2), Math.round(height / 2)];
  let t = titleEnd + P.firstStepLeadMs;
  const byIndex = new Map(take.steps.map((s) => [s.index, s]));

  script.steps.forEach((step: Step, index) => {
    const log = byIndex.get(index);
    if (!log) throw new Error(`The take has nothing for step ${index + 1}.`);
    const start = t;
    const narrationEnd = speak(`step-${index}`, step.silent ? undefined : step.narration, start);
    let actionMs = start;
    let actionEnd = start;
    const highlight = step.highlight ?? true;

    // Move the pointer to the control first, for every action that has one.
    const goTo = (rect: Rect): number => {
      const b = centre(rect);
      const d = Math.hypot(b[0] - pointer[0], b[1] - pointer[1]);
      const travel = d < 2 ? 0 : travelMs(d / scale);
      if (travel > 0) moves.push({ fromMs: start, toMs: start + travel, a: pointer, b });
      pointer = b;
      if (log.hover) pictureAt.push({ ms: start + travel, picture: log.hover });
      return start + travel;
    };
    const press = (at: number) => {
      if (highlight) clicks.push({ ms: at, x: pointer[0], y: pointer[1] });
    };
    const changes = log.changes;
    const showChanges = (from: number, every: number, fade?: number) => {
      changes.forEach((p, k) => pictureAt.push({ ms: from + k * every, picture: p, fade }));
      return from + Math.max(0, changes.length - 1) * every;
    };

    switch (step.action) {
      case "click": {
        if (!log.target) throw new Error(`Step ${index + 1} has no control position from the take.`);
        actionMs = goTo(log.target.rect) + P.clickDwellMs;
        press(actionMs);
        actionEnd = showChanges(actionMs + P.responseMs, 0);
        break;
      }
      case "type": {
        let typeFrom = start + P.keyLeadMs;
        if (log.target) {
          const clickAt = goTo(log.target.rect) + P.clickDwellMs;
          press(clickAt);
          // The first change is the field taking focus when clicked; the rest are the characters.
          if (changes.length > 0) pictureAt.push({ ms: clickAt + P.responseMs, picture: changes[0] });
          typeFrom = clickAt + 250;
          actionMs = typeFrom;
          const typed = changes.slice(1);
          typed.forEach((p, k) => pictureAt.push({ ms: typeFrom + k * P.typeCharMs, picture: p }));
          actionEnd = typeFrom + Math.max(0, typed.length - 1) * P.typeCharMs;
        } else {
          actionMs = typeFrom;
          actionEnd = showChanges(typeFrom, P.typeCharMs);
        }
        break;
      }
      case "key": {
        if (log.target) goTo(log.target.rect);
        actionMs = start + P.keyLeadMs;
        const key = parseKey(step.value ?? "");
        const text = key ? [...key.modifiers, key.key].join(" + ") : (step.value ?? "");
        const w = Math.round((80 + text.length * 22) * scale);
        const h = Math.round(84 * scale);
        marksMs.push({
          kind: "key", fromMs: actionMs, toMs: actionMs + P.keyBadgeMs, text, fontPx: Math.round(40 * scale),
          rect: [Math.round(width / 2 - w / 2), Math.round(height - 150 * scale), w, h],
        });
        actionEnd = showChanges(actionMs + P.responseMs, 0);
        break;
      }
      case "scroll": {
        actionMs = log.target ? goTo(log.target.rect) + P.clickDwellMs : start + P.keyLeadMs;
        actionEnd = showChanges(actionMs, P.scrollStepMs);
        break;
      }
      case "open": {
        actionMs = start + P.keyLeadMs;
        actionEnd = showChanges(actionMs, 0, P.fadeMs);
        break;
      }
      case "wait": {
        actionMs = start;
        actionEnd = start + Math.round(Number(step.value ?? "1") * 1000);
        showChanges(start, 0);
        break;
      }
      case "drag":
        throw new Error("Drag is not performed in this version.");
    }

    const end = Math.max(narrationEnd, actionEnd + P.afterActionMs) + Math.round((step.hold ?? 0) * 1000);

    // The callout shows from when the pointer is there (or the step starts) to the end of the step.
    if (step.callout && log.callout) {
      const r = log.callout.rect;
      const color = step.callout.color;
      const from = Math.min(actionMs, end);
      const pad = Math.round(8 * scale);
      if (step.callout.type === "box") {
        marksMs.push({ kind: "box", fromMs: from, toMs: end, rect: [r[0] - pad, r[1] - pad, r[2] + 2 * pad, r[3] + 2 * pad], color });
      } else if (step.callout.type === "arrow") {
        const [startPt, endPt] = arrowFor(r, step.callout.from, width, height, scale);
        marksMs.push({ kind: "arrow", fromMs: from, toMs: end, start: startPt, end: endPt, color });
      } else {
        marksMs.push({ kind: "label", fromMs: from, toMs: end, rect: labelFor(r, step.callout.text, step.callout.side, width, height, scale), text: step.callout.text, color: "#FFFFFF", fontPx: Math.round(32 * scale), ...(color ? { background: color } : {}) });
      }
    }

    steps.push({ index, startMs: start, endMs: end, actionMs, ...(step.chapter ? { chapter: step.chapter } : {}) });
    t = end + P.stepGapMs;
  });

  // End card, with the outro spoken over it.
  const endCardStart = t - P.stepGapMs + P.tailMs;
  const outroEnd = speak("outro", script.outro, endCardStart + P.introLeadMs);
  const totalMs = Math.max(endCardStart + P.endCardMinMs, script.outro ? outroEnd + 800 : 0);

  // Everything to frames.
  const totalFrames = frame(totalMs);
  const titleFrames = frame(titleEnd);
  const endFrame = frame(endCardStart);
  const segments: Segment[] = [];
  const push = (from: number, to: number, seg: Omit<Segment, "from" | "to">) => {
    if (to <= from) return;
    const last = segments[segments.length - 1];
    if (last && last.picture && seg.picture === last.picture && !seg.fadeIn && last.to === from) {
      last.to = to;
      return;
    }
    segments.push({ from, to, ...seg });
  };
  push(0, titleFrames, { card: titleCard(script) });
  const changes = pictureAt
    .map((c) => ({ f: Math.min(Math.max(frame(c.ms), titleFrames), endFrame), picture: c.picture, fade: c.fade }))
    .sort((a, b) => a.f - b.f);
  for (let k = 0; k < changes.length; k++) {
    const c = changes[k];
    const next = k + 1 < changes.length ? changes[k + 1].f : endFrame;
    const fadeIn = c.fade ? Math.min(frame(c.fade), next - c.f) : 0;
    push(c.f, next, { picture: c.picture, ...(fadeIn > 0 ? { fadeIn } : {}) });
  }
  push(endFrame, totalFrames, { card: endCard(script), fadeIn: frame(P.fadeMs) });

  // The pointer: hidden on the cards, resting or travelling in between.
  const pointerFrames: ([number, number] | null)[] = new Array(totalFrames).fill(null);
  let rest: [number, number] = [Math.round(width / 2), Math.round(height / 2)];
  const moveFrames = moves.map((m) => ({ from: frame(m.fromMs), to: frame(m.toMs), m }));
  let mi = 0;
  for (let f = titleFrames; f < endFrame; f++) {
    while (mi < moveFrames.length && moveFrames[mi].to <= f) {
      rest = moveFrames[mi].m.b;
      mi++;
    }
    const mf = moveFrames[mi];
    if (mf && mf.from <= f && f < mf.to) {
      pointerFrames[f] = pointerAt(mf.m.a, mf.m.b, (f - mf.from) / Math.max(1, mf.to - mf.from));
    } else {
      pointerFrames[f] = rest;
    }
  }

  const marks: Mark[] = marksMs
    .map(({ fromMs, toMs, ...m }) => ({ ...m, from: Math.max(frame(fromMs), titleFrames), to: Math.min(frame(toMs), endFrame) }))
    .filter((m) => m.to > m.from);

  return {
    fps, width, height, frames: totalFrames, segments, pointer: pointerFrames,
    clicks: clicks.map((c) => ({ frame: frame(c.ms), x: c.x, y: c.y })),
    marks, cues, clips: clipsOut, steps, durationMs: Math.round((totalFrames * 1000) / fps),
  };
}

export function titleCard(script: Script): Card {
  return { kicker: script.program.name, title: script.title, lines: [script.goal] };
}

export function endCard(script: Script): Card {
  const lines = [];
  if (script.playlist) lines.push(`More videos in the playlist ${script.playlist.name}`);
  lines.push(`The ${script.program.name} manual has every step in writing.`);
  return { kicker: script.program.name, title: "Thanks for watching", lines };
}

function arrowFor(r: Rect, from: Side | undefined, width: number, height: number, scale: number): [[number, number], [number, number]] {
  const [x, y, w, h] = r;
  const gap = 10 * scale;
  const len = 170 * scale;
  const side: Side = from ?? (y + h + len + 40 < height ? "below" : x - len - 40 > 0 ? "left" : "above");
  const [cx, cy] = centre(r);
  switch (side) {
    case "below": return [[cx, y + h + gap + len], [cx, y + h + gap]];
    case "above": return [[cx, y - gap - len], [cx, y - gap]];
    case "left": return [[x - gap - len, cy], [x - gap, cy]];
    case "right": return [[x + w + gap + len, cy], [x + w + gap, cy]];
  }
  void width;
}

function labelFor(r: Rect, text: string, side: Side | undefined, width: number, height: number, scale: number): Rect {
  const w = Math.round(Math.min(width * 0.45, (60 + text.length * 17) * scale));
  const h = Math.round(64 * scale);
  const gap = Math.round(16 * scale);
  const [x, y, rw, rh] = r;
  const s: Side = side ?? (y + rh + gap + h < height ? "below" : "above");
  let lx = x + rw / 2 - w / 2;
  let ly = y + rh + gap;
  if (s === "above") ly = y - gap - h;
  if (s === "left") [lx, ly] = [x - gap - w, y + rh / 2 - h / 2];
  if (s === "right") [lx, ly] = [x + rw + gap, y + rh / 2 - h / 2];
  lx = Math.max(8, Math.min(width - w - 8, lx));
  ly = Math.max(8, Math.min(height - h - 8, ly));
  return [Math.round(lx), Math.round(ly), w, h];
}
