import test from "node:test";
import assert from "node:assert/strict";
import { makeDescriptions, descriptionCaptions, stepDescription } from "../src/captions/descriptions.ts";
import { makeTranscript, toVtt } from "../src/captions/captions.ts";
import type { Script } from "../src/script/format.ts";
import type { Timeline } from "../src/timeline/build.ts";
import { validateScript } from "../src/script/validate.ts";
import { migrateScript } from "../src/script/migrate.ts";
import { scriptTexts } from "../src/guard/script-scan.ts";

const script: Script = {
  format: "openstage-studio-script", version: 3, title: "Plan a lesson", goal: "Make a lesson plan.",
  program: { id: "practice-planner", name: "Practice Planner" }, startState: { demoProject: "demo-lessons-01" },
  playlist: { name: "Basics", position: 1 },
  steps: [
    { action: "click", target: "toolbar.lesson.new", narration: "Select New lesson.", describe: "A new, untitled lesson appears at the bottom of the list" },
    { action: "type", target: "editor.title", value: "Sorting leaves", narration: "Give the lesson a title." },
    { action: "type", target: "editor.subject", value: "Science", narration: "Choose Science as the subject." },
    { action: "key", value: "Ctrl+S", narration: "Save it.", callout: { type: "label", text: "Saved here", near: "statusbar" } },
  ],
};

const timeline = {
  durationMs: 30000,
  steps: [
    { index: 0, startMs: 4000, actionMs: 5000, endMs: 9000 },
    { index: 1, startMs: 9000, actionMs: 10000, endMs: 14000 },
    { index: 2, startMs: 14000, actionMs: 15000, endMs: 19000 },
    { index: 3, startMs: 19000, actionMs: 20000, endMs: 25000 },
  ],
} as unknown as Timeline;

test("each step's description says what the narration does not: typed words, keys, a label, and the author's words", () => {
  assert.equal(stepDescription(script.steps[0]), "A new, untitled lesson appears at the bottom of the list.");
  assert.equal(stepDescription(script.steps[1], "Lesson title"), 'The words "Sorting leaves" are entered in Lesson title.');
  assert.equal(stepDescription(script.steps[2], "Subject"), "", "the narration already says Science");
  assert.equal(stepDescription(script.steps[3]), "The keys Ctrl plus S show at the bottom of the screen. A label reads: Saved here.");
});

test("the description track is timed from each step's action, never overlaps, and has the cards", () => {
  const ds = makeDescriptions(script, timeline, [undefined, "Lesson title"]);
  assert.deepEqual(ds.map((d) => d.of), ["title", 1, 2, 4, "end"]);
  assert.equal(ds[0].text, "Title card: Plan a lesson. Practice Planner. Make a lesson plan.");
  assert.deepEqual([ds[1].startMs, ds[1].endMs], [5000, 9000]);
  assert.equal(ds[4].text, "End card: Thanks for watching. More videos in the playlist Basics. The Practice Planner manual has every step in writing.");
  for (let k = 0; k + 1 < ds.length; k++) assert.ok(ds[k].endMs <= ds[k + 1].startMs);
  const vtt = toVtt(descriptionCaptions(ds));
  assert.match(vtt, /^WEBVTT\n\n00:00:00\.000 --> 00:00:04\.000\n/);
});

test("the transcript carries each step's description", () => {
  const t = makeTranscript(script, timeline, []);
  assert.match(t, /Narration: Select New lesson\.\nDescription: A new, untitled lesson appears at the bottom of the list\n/);
});

test("version 3 adds describe: checked for length, scanned for blocked names, and older scripts are brought up to date", () => {
  assert.ok(validateScript(script).ok);
  const long = { ...script, steps: [{ ...script.steps[0], describe: "x".repeat(281) }] };
  assert.match(validateScript(long).errors.map((e) => e.message).join(" "), /at most 280 characters/);
  assert.ok(scriptTexts(script).some((t) => t.path === "steps[0].describe"));
  const old = migrateScript({ ...script, version: 2 });
  // Brought up to the current version (4 since 2026-11-26, which added steps in another program's window).
  assert.equal((old.data as Script).version, 4);
  assert.equal(old.from, 2);
});
