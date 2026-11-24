import test from "node:test";
import assert from "node:assert/strict";
import { makeBlocklist } from "../src/guard/blocklist.ts";
import { scanFrames, shortHash, timeOf, type OcrResult } from "../src/guard/frame-scan.ts";
import { redactionSpans, stepsAt, wordSpans } from "../src/guard/redact.ts";
import type { Script } from "../src/script/format.ts";
import type { TakeLog, Timeline } from "../src/timeline/build.ts";

const { list } = makeBlocklist([{ byCategory: { product: ["Zentrova Planner"] } }]);
// Two steps; picture p1 shows from frame 90 to 150 (step 1), p2 from 150 to 240 (step 2). Cards before and after.
const timeline = {
  fps: 30, width: 1920, height: 1080, frames: 300,
  segments: [{ from: 0, to: 90, card: { title: "T" } }, { from: 90, to: 150, picture: "p1" }, { from: 150, to: 240, picture: "p2" }, { from: 240, to: 300, card: { title: "End" } }],
  pointer: [], clicks: [], marks: [], cues: [], clips: [],
  steps: [{ index: 0, startMs: 3000, endMs: 4800, actionMs: 3100 }, { index: 1, startMs: 5000, endMs: 7800, actionMs: 5100 }],
  durationMs: 10000,
} as Timeline;
const word = (text: string, x: number) => ({ text, rect: [x, 400, text.length * 12, 22] as [number, number, number, number] });
const line = (words: { text: string; rect: [number, number, number, number] }[]) => ({ text: words.map((w) => w.text).join(" "), rect: [words[0].rect[0], 400, 600, 22] as [number, number, number, number], words });
const ocr: OcrResult = {
  p1: [line([word("Imported", 700), word("from", 810), word("Zentr0va", 870), word("Planner", 980)])],
  p2: [line([word("Imported", 700), word("from", 810), word("Zentr0va", 870), word("Planner", 980)]), line([word("Nothing", 100), word("here", 200)])],
};
const take: TakeLog = { width: 1920, height: 1080, start: "p1", steps: [], pageText: { p1: [{ text: "Imported from Zentrova Planner", rect: [700, 400, 400, 22] }] } };
const script = { steps: [{}, {}] } as unknown as Script;

test("a name seen in several pictures, read and reported, is one flag over every frame it shows", () => {
  const flags = scanFrames({ script, take, timeline, ocr, list });
  assert.equal(flags.length, 1);
  const f = flags[0];
  assert.equal(f.term, "Zentrova Planner");
  assert.deepEqual(f.shown, [[90, 240]]);
  assert.deepEqual(f.steps, [1, 2]);
  assert.deepEqual(new Set(f.sightings.map((s) => s.source)), new Set(["picture", "page"]));
  assert.deepEqual(f.rect, [870, 400, 194, 22], "placed on the words read from the picture");
  assert.equal(f.covered, false);
  assert.equal(scanFrames({ script, take, timeline, ocr, list })[0].id, f.id, "the same pictures give the same id");
});

test("a blurred box over every frame it shows covers it; a box over part of the time does not", () => {
  const all = { steps: [{}, {}], redactions: [{ box: [860, 390, 220, 40], fromStep: 1, toStep: 2 }] } as unknown as Script;
  assert.equal(scanFrames({ script: all, take, timeline, ocr, list })[0].covered, true);
  const part = { steps: [{}, {}], redactions: [{ box: [860, 390, 220, 40], fromStep: 1, toStep: 1 }] } as unknown as Script;
  assert.equal(scanFrames({ script: part, take, timeline, ocr, list })[0].covered, false);
  assert.deepEqual(redactionSpans(part, timeline), [{ from: 90, to: 150, box: [860, 390, 220, 40] }], "cards are never blurred");
});

test("a blurred box lasts until the picture changes, when the next step starts before its picture", () => {
  // Step 2 starts at frame 135, but its action's picture (p2) only shows from frame 150: p1 is still on screen until then.
  const early = { ...timeline, steps: [timeline.steps[0], { ...timeline.steps[1], startMs: 4500 }] } as Timeline;
  const part = { steps: [{}, {}], redactions: [{ box: [860, 390, 220, 40], fromStep: 1, toStep: 1 }] } as unknown as Script;
  assert.deepEqual(redactionSpans(part, early), [{ from: 90, to: 150, box: [860, 390, 220, 40] }]);
});

test("a blurred box covers the press picture of the next step's click, which still shows the old screen", () => {
  // Step 2 starts at frame 140; its click shows the press (p1b, the old screen) from 150, and the result (p2) from 158, after the action at 156.
  const press = {
    ...timeline,
    segments: [timeline.segments[0], { from: 90, to: 150, picture: "p1" }, { from: 150, to: 158, picture: "p1b" }, { from: 158, to: 240, picture: "p2" }, timeline.segments[3]],
    steps: [timeline.steps[0], { ...timeline.steps[1], startMs: 4667, actionMs: 5200 }],
  } as Timeline;
  const part = { steps: [{}, {}], redactions: [{ box: [860, 390, 220, 40], fromStep: 1, toStep: 1 }] } as unknown as Script;
  assert.deepEqual(redactionSpans(part, press), [{ from: 90, to: 158, box: [860, 390, 220, 40] }]);
});

test("steps and times are said the way people count them", () => {
  assert.deepEqual(stepsAt(0, 90, timeline), [0, 0]);
  assert.deepEqual(stepsAt(150, 240, timeline), [2, 2]);
  assert.equal(timeOf(137, 30), "0:04.6");
  assert.equal(shortHash("abc").length, 8);
});

test("a project's words are blurred in each picture where the program says they are, with any slash and capitals", () => {
  const shown: TakeLog = { width: 1920, height: 1080, start: "p1", steps: [], pageText: {
    p1: [{ text: "Saved", rect: [100, 300, 60, 20] }, { text: "c:/Work/Takes/a report.docx", rect: [170, 300, 300, 20] }],
    p2: [{ text: String.raw`C:\Work\Takes\a report.docx`, rect: [170, 200, 300, 20] }],
  } };
  assert.deepEqual(wordSpans([String.raw`C:\Work\Takes`], shown, timeline), [{ from: 90, to: 150, box: [164, 294, 312, 32] }, { from: 150, to: 240, box: [164, 194, 312, 32] }]);
  assert.deepEqual(wordSpans([], shown, timeline), []);
  const read: OcrResult = { p1: [], p2: [] };
  const flags = scanFrames({ script, take: shown, timeline, ocr: read, list, blur: [String.raw`c:\work`] });
  assert.ok(flags.length > 0 && flags.every((x) => x.covered), "a path the words cover is already blurred");
  assert.ok(scanFrames({ script, take: shown, timeline, ocr: read, list }).every((x) => !x.covered));
});
