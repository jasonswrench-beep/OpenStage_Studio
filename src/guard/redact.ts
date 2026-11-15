// Blurred boxes (redactions): where on the timeline each one applies. A redaction names steps; the video shows the take's
// pictures, so a box covers every frame that shows a picture from the start of its first step to the start of the step
// after its last. Title and end cards are never blurred.

import type { Redaction, Script } from "../script/format.ts";
import type { Rect, Timeline } from "../timeline/build.ts";

export interface RedactionSpan {
  /** First frame covered, and the frame after the last. */
  from: number;
  to: number;
  box: Rect;
}

const frameOf = (ms: number, fps: number) => Math.round((ms * fps) / 1000);

/** The frames that show the take's pictures, from the first picture to the end card. */
function pictureFrames(timeline: Timeline): [number, number] {
  const first = timeline.segments.find((s) => s.picture)?.from ?? 0;
  const end = [...timeline.segments].reverse().find((s) => s.picture)?.to ?? timeline.frames;
  return [first, end];
}

/** The frames a redaction covers. */
export function redactionFrames(r: Redaction, timeline: Timeline): [number, number] {
  const [first, end] = pictureFrames(timeline);
  const steps = timeline.steps;
  const from = r.fromStep <= 0 ? first : frameOf(steps[r.fromStep - 1]?.startMs ?? 0, timeline.fps);
  const to = r.toStep < steps.length ? frameOf(steps[r.toStep].startMs, timeline.fps) : end;
  return [Math.max(first, from), Math.min(end, to)];
}

/** Every redaction of a script as frame spans, only over segments that show a picture. */
export function redactionSpans(script: Script, timeline: Timeline): RedactionSpan[] {
  const out: RedactionSpan[] = [];
  for (const r of script.redactions ?? []) {
    const [from, to] = redactionFrames(r, timeline);
    for (const s of timeline.segments) {
      if (!s.picture) continue;
      const a = Math.max(from, s.from), b = Math.min(to, s.to);
      if (b > a) out.push({ from: a, to: b, box: r.box });
    }
  }
  // Join spans of one box that follow on from each other.
  const joined: RedactionSpan[] = [];
  for (const s of out.sort((p, q) => p.box.join().localeCompare(q.box.join()) || p.from - q.from)) {
    const last = joined[joined.length - 1];
    if (last && last.box.join() === s.box.join() && last.to >= s.from) last.to = Math.max(last.to, s.to);
    else joined.push({ ...s });
  }
  return joined.sort((p, q) => p.from - q.from || p.box.join().localeCompare(q.box.join()));
}

/** Whether a box lies inside another, allowing a couple of pixels. */
export function inside(inner: Rect, outer: Rect, slack = 2): boolean {
  return inner[0] >= outer[0] - slack && inner[1] >= outer[1] - slack
    && inner[0] + inner[2] <= outer[0] + outer[2] + slack && inner[1] + inner[3] <= outer[1] + outer[3] + slack;
}

/** A box grown on every side, kept inside the picture. */
export function grow(r: Rect, by: number, width = 1920, height = 1080): Rect {
  const x = Math.max(0, r[0] - by), y = Math.max(0, r[1] - by);
  const right = Math.min(width, r[0] + r[2] + by), bottom = Math.min(height, r[1] + r[3] + by);
  return [x, y, right - x, bottom - y];
}

/** Which steps (counting from 1, 0 for the starting picture) a range of frames falls in. */
export function stepsAt(from: number, to: number, timeline: Timeline): [number, number] {
  const starts = timeline.steps.map((s) => frameOf(s.startMs, timeline.fps));
  const stepOf = (f: number) => {
    let k = 0;
    while (k < starts.length && starts[k] <= f) k++;
    return k;
  };
  return [stepOf(from), stepOf(Math.max(from, to - 1))];
}
