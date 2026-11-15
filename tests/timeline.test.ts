import test from "node:test";
import assert from "node:assert/strict";
import type { Script } from "../src/script/format.ts";
import { buildTimeline, ease, pointerAt, travelMs, type TakeLog } from "../src/timeline/build.ts";

const script = (): Script => ({
  format: "openstage-studio-script",
  version: 1,
  title: "Add a lesson",
  goal: "Make a new lesson.",
  program: { id: "practice-planner", name: "Practice Planner" },
  startState: { demoProject: "demo-lessons-01" },
  intro: "Hello.",
  steps: [
    { action: "click", target: "toolbar.lesson.new", narration: "Select New lesson.", callout: { type: "box", around: "toolbar.lesson.new" }, chapter: "Start" },
    { action: "type", target: "editor.title", value: "Leaf", narration: "Type a title." },
    { action: "key", value: "Ctrl+S", narration: "Save.", hold: 0.5 },
  ],
});

const take = (): TakeLog => ({
  width: 1920,
  height: 1080,
  start: "p0",
  steps: [
    { index: 0, target: { rect: [100, 20, 120, 40] }, hover: "h0", changes: ["p1"], callout: { rect: [100, 20, 120, 40] } },
    { index: 1, target: { rect: [500, 200, 600, 50] }, hover: "h1", changes: ["f1", "c1", "c2", "c3", "c4"] },
    { index: 2, changes: ["s1"] },
  ],
});

const clips = { intro: 1500, "step-0": 2000, "step-1": 1800, "step-2": 900 };

test("the same inputs always give the same timeline", () => {
  const a = buildTimeline({ script: script(), take: take(), clips });
  const b = buildTimeline({ script: script(), take: take(), clips });
  assert.deepEqual(a, b);
});

test("pieces follow one another without gaps from the title card to the end card", () => {
  const t = buildTimeline({ script: script(), take: take(), clips });
  assert.equal(t.segments[0].from, 0);
  assert.ok(t.segments[0].card, "the video opens on the title card");
  assert.ok(t.segments[t.segments.length - 1].card, "and ends on the end card");
  for (let k = 1; k < t.segments.length; k++) assert.equal(t.segments[k].from, t.segments[k - 1].to);
  assert.equal(t.segments[t.segments.length - 1].to, t.frames);
  assert.equal(t.pointer.length, t.frames);
});

test("narration sets the pace: a longer clip makes a longer step and moves everything after it", () => {
  const short = buildTimeline({ script: script(), take: take(), clips });
  const long = buildTimeline({ script: script(), take: take(), clips: { ...clips, "step-0": 4000 } });
  assert.equal(long.steps[0].endMs - short.steps[0].endMs, 2000);
  assert.equal(long.steps[1].startMs - short.steps[1].startMs, 2000);
  assert.equal(long.durationMs - short.durationMs, 2000);
});

test("the title card lasts at least three seconds, longer when the intro needs it", () => {
  const t = buildTimeline({ script: script(), take: take(), clips });
  assert.ok(t.segments[0].to >= 90);
  const longIntro = buildTimeline({ script: script(), take: take(), clips: { ...clips, intro: 5000 } });
  assert.ok(longIntro.segments[0].to > 150);
});

test("each picture of the take shows, in order, and typing shows one character at a time", () => {
  const t = buildTimeline({ script: script(), take: take(), clips });
  const shown = t.segments.filter((s) => s.picture).map((s) => s.picture);
  assert.deepEqual(shown, ["p0", "h0", "p1", "h1", "f1", "c1", "c2", "c3", "c4", "s1"]);
  const c = (id: string) => t.segments.find((s) => s.picture === id)!.from;
  assert.ok(c("c2") > c("c1") && c("c3") > c("c2"));
});

test("a click happens where the pointer is, after it arrives, with the yellow circle", () => {
  const t = buildTimeline({ script: script(), take: take(), clips });
  const first = t.clicks[0];
  assert.deepEqual([first.x, first.y], [160, 40]);
  assert.deepEqual(t.pointer[first.frame], [160, 40]);
  assert.ok(t.pointer[first.frame - 20], "the pointer is shown before the click");
  assert.equal(t.pointer[0], null, "and hidden on the title card");
});

test("callouts, key badges and chapters come from the script", () => {
  const t = buildTimeline({ script: script(), take: take(), clips });
  const box = t.marks.find((m) => m.kind === "box")!;
  assert.deepEqual(box.rect, [92, 12, 136, 56]);
  const key = t.marks.find((m) => m.kind === "key")!;
  assert.equal(key.text, "Ctrl + S");
  assert.equal(t.steps[0].chapter, "Start");
  assert.equal(t.steps[2].endMs - t.steps[2].startMs >= 1400, true, "hold adds to the step");
});

test("a silent step makes no clip and no caption", () => {
  const s = script();
  s.steps[2] = { action: "key", value: "Ctrl+S", silent: true };
  const t = buildTimeline({ script: s, take: take(), clips });
  assert.equal(t.clips.some((c) => c.id === "step-2"), false);
  assert.equal(t.cues.length, 3);
});

test("a missing clip or a missing take step is said plainly", () => {
  assert.throws(() => buildTimeline({ script: script(), take: take(), clips: { intro: 1 } }), /no narration clip for step-0/);
  const tk = take();
  tk.steps.pop();
  assert.throws(() => buildTimeline({ script: script(), take: tk, clips }), /nothing for step 3/);
});

test("the pointer moves smoothly and arrives exactly", () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.ok(ease(0.25) < 0.25 && ease(0.75) > 0.75, "slow at the ends");
  assert.deepEqual(pointerAt([0, 0], [100, 0], 1), [100, 0]);
  assert.deepEqual(pointerAt([0, 0], [100, 0], 0), [0, 0]);
  assert.ok(travelMs(5) >= 450 && travelMs(5000) <= 1300);
});
