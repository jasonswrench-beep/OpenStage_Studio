import test from "node:test";
import assert from "node:assert/strict";
import { captionLines, captionPieces, describeAction, LINE_MAX, makeCaptions, makeChapters, toSrt, toVtt } from "../src/captions/captions.ts";
import { applyPronunciations, clipKey, narrationLines } from "../src/narration/narration.ts";
import type { Script } from "../src/script/format.ts";
import type { Timeline } from "../src/timeline/build.ts";

test("captions are at most two lines of 42 characters", () => {
  const text = "Select Share this lesson with the class page, so your class can see the plan. Then select OK to close the settings and go back.";
  for (const piece of captionPieces(text)) {
    const lines = captionLines(piece);
    assert.ok(lines.length <= 2, piece);
    for (const l of lines) assert.ok(l.length <= LINE_MAX, l);
  }
  assert.deepEqual(captionPieces("Short line."), ["Short line."]);
});

test("a long cue is split into captions timed in proportion to their length, end to end", () => {
  const caps = makeCaptions([{ id: "a", startMs: 1000, endMs: 9000, text: "This is the first sentence of a long piece of narration. And this is the second sentence, which is about as long." }]);
  assert.ok(caps.length >= 2);
  assert.equal(caps[0].startMs, 1000);
  assert.equal(caps[caps.length - 1].endMs, 9000);
  for (let k = 1; k < caps.length; k++) assert.equal(caps[k].startMs, caps[k - 1].endMs);
});

test("SRT and VTT are written with their own time formats", () => {
  const caps = [{ startMs: 1500, endMs: 62_250, lines: ["Select New lesson."] }];
  assert.equal(toSrt(caps), "1\r\n00:00:01,500 --> 00:01:02,250\r\nSelect New lesson.\r\n");
  assert.equal(toVtt(caps), "WEBVTT\n\n00:00:01.500 --> 00:01:02.250\nSelect New lesson.\n");
});

test("a caption stays up at least a second unless the next one starts", () => {
  const caps = makeCaptions([
    { id: "a", startMs: 0, endMs: 300, text: "Quick." },
    { id: "b", startMs: 5000, endMs: 6000, text: "Next." },
  ]);
  assert.equal(caps[0].endMs, 1000);
});

test("the transcript describes what happens on screen", () => {
  assert.equal(describeAction({ action: "click", target: "toolbar.lesson.new" }, "New lesson"), 'Click "New lesson".');
  assert.equal(describeAction({ action: "key", value: "Ctrl+S" }), "Press Ctrl+S.");
  assert.equal(describeAction({ action: "type", value: "Leaves" }), 'Type "Leaves".');
});

test("chapters start at 0:00 and warn when there are too few for video sites", () => {
  const timeline = { durationMs: 125_000, steps: [{ index: 0, startMs: 4000, endMs: 9000, actionMs: 5000, chapter: "Start a lesson" }, { index: 1, startMs: 65_000, endMs: 70_000, actionMs: 66_000, chapter: "Save" }] } as unknown as Timeline;
  const c = makeChapters({} as Script, timeline);
  assert.equal(c.text, "0:00 Start a lesson\n1:05 Save\n", "a chapter starting in the first 10 seconds takes over 0:00");
  assert.ok(c.warnings.some((w) => /at least three/.test(w)), "two chapters are too few for video sites");
});

test("pronunciations change what is spoken, never what the captions show", () => {
  assert.equal(applyPronunciations("Open OpenStage, then openstage again.", { OpenStage: "Open Stage" }), "Open Open Stage, then Open Stage again.");
  assert.equal(applyPronunciations("OpenStages", { OpenStage: "Open Stage" }), "OpenStages", "whole words only");
  const script = { intro: "Welcome to QDA.", steps: [{ action: "wait", narration: "QDA is ready." }, { action: "wait", silent: true }] } as unknown as Script;
  const lines = narrationLines(script, { QDA: "Q D A" });
  assert.deepEqual(lines.map((l) => [l.id, l.text, l.spoken]), [["intro", "Welcome to QDA.", "Welcome to Q D A."], ["step-0", "QDA is ready.", "Q D A is ready."]]);
});

test("a clip's key changes when its words or its voice change, and only then", () => {
  const line = { id: "step-0", text: "Hi.", spoken: "Hi." };
  const voice = { engine: "windows" as const, voice: "default", rate: 1 };
  assert.equal(clipKey(line, voice), clipKey({ ...line, id: "step-9" }, voice), "moving a line does not remake it");
  assert.notEqual(clipKey(line, voice), clipKey({ ...line, spoken: "Hello." }, voice));
  assert.notEqual(clipKey(line, voice), clipKey(line, { ...voice, rate: 1.1 }));
  const kokoro = { engine: "kokoro" as const, voice: "af_heart", rate: 1, model: "1939ad2" };
  assert.notEqual(clipKey(line, kokoro), clipKey(line, { ...kokoro, words: 2 }), "a new way of saying words remakes the clip");
});
