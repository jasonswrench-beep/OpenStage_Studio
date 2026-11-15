import test from "node:test";
import assert from "node:assert/strict";
import type { Answerer, Question } from "../src/ai/ask.ts";
import { jsonIn } from "../src/ai/ask.ts";
import { cleanStep, collapseRepeats, controlLines, planVideos, repairStep, writeMetadata, writeScript } from "../src/ai/roles.ts";
import { typingProblem } from "../src/ai/rehearse.ts";
import type { Step } from "../src/script/format.ts";
import { describeChoice, missing } from "../src/ai/settings.ts";
import { readProjectManual } from "../src/manual/import.ts";
import { chapterText, findChapter } from "../src/manual/manual.ts";
import { findProgram } from "../src/pipeline/programs.ts";
import type { Script } from "../src/script/format.ts";
import { fitsPattern, validateScript } from "../src/script/validate.ts";
import { matches, readZip, safeName } from "../src/util/zip.ts";
import { readFileSync } from "node:fs";

/** A stand-in model that gives the written answers in turn, and remembers what it was asked. */
function standIn(answers: string[]): Answerer & { asked: Question[] } {
  const asked: Question[] = [];
  return { name: "a stand-in model", pictures: false, asked, ask: async (q) => (asked.push(q), answers.shift() ?? "{}"), close: async () => undefined };
}

const program = findProgram("practice-planner");
const controls = [
  { id: "toolbar.lesson.new", label: "New lesson", role: "button", shownAtStart: true },
  { id: "editor.title", label: "Lesson title", role: "textbox", shownAtStart: false },
  { id: "toolbar.insert", label: "Insert", role: "button", shownAtStart: true },
  { id: "menu.insert.objective", label: "Learning objective", role: "menuitem", shownAtStart: false },
  { id: "editor.save", label: "Save lesson", role: "button", shownAtStart: false },
];
const check = (s: Script) => validateScript(s, { controls: controls.map((c) => c.id), controlPatterns: ["sidebar.lesson.*"] }).errors.map((e) => `${e.path}: ${e.message}`);
const MANUAL = "examples/manuals/Practice Planner Guide.openexplainer";

test("the invented manual reads as a documentation project, with its steps and what was clicked", () => {
  const m = readProjectManual(MANUAL);
  assert.equal(m.product, "Practice Planner");
  assert.deepEqual(m.chapters.map((c) => c.title), ["About this guide", "Planning lessons"]);
  const ch = findChapter(m, "planning");
  assert.equal(ch.topics.filter((t) => t.depth === 1).length, 6);
  const text = chapterText(ch);
  assert.match(text, /1\. On the toolbar, click \[\[New lesson\]\]\. \(clicked: button "New lesson"\)/);
  assert.match(text, /Result: A blank lesson opens on the right/);
  assert.throws(() => findChapter(m, "nowhere"), /has no chapter called "nowhere"/);
});

test("zip names that could reach outside a folder are refused", () => {
  assert.ok(safeName("topics/a.json"));
  for (const bad of ["../x", "/x", "C:x", "a\\b", "a/../b", ""]) assert.equal(safeName(bad), false, bad);
  assert.ok(matches("ggml-cpu-zen4.dll", "ggml-cpu*.dll"));
  assert.equal(matches("ggml-cpu-zen4.exe", "ggml-cpu*.dll"), false);
  assert.ok(readZip(readFileSync(MANUAL)).some((e) => e.name === "project.json"));
});

test("an answer's JSON is found among words and code fences", () => {
  assert.deepEqual(jsonIn('Here it is:\n```json\n{"a": [1, "}"]}\n```'), { a: [1, "}"] });
  assert.throws(() => jsonIn("no json"), /no JSON/);
});

test("the planner's videos get stable names, positions and the proposed status", async () => {
  const a = standIn([JSON.stringify({ playlist: "Planning lessons", videos: [{ title: "Make a new lesson", goal: "You can make a lesson.", covers: ["Making a new lesson"] }, { title: "Make a new lesson", goal: "Again." }] })]);
  const p = await planVideos(a, program, "Guide", "Planning lessons", "text");
  assert.deepEqual(p.videos.map((v) => [v.id, v.position, v.status]), [["make-a-new-lesson", 1, "proposed"], ["make-a-new-lesson-2", 2, "proposed"]]);
});

test("the scriptwriter is asked again with the problems until its script passes the check", async () => {
  const bad = { title: "Make a lesson", goal: "You can make a lesson.", startState: { demoProject: "demo-lessons-01" }, steps: [{ action: "click", target: "New lesson", narration: "Select New lesson." }] };
  const good = { ...bad, steps: [{ action: "Click", target: "toolbar.lesson.new", narration: "Select New lesson.", expect: "A blank lesson", extra: "dropped" }, { action: "type", target: "editor.title", value: "Leaves", narration: "Type a title." }] };
  const a = standIn([JSON.stringify(bad), JSON.stringify(good)]);
  const { script, rounds } = await writeScript(a, { program, video: { id: "v", title: "Make a lesson", goal: "You can make a lesson.", covers: [], position: 1, status: "approved" }, manualText: "1. Click New lesson.", controls, check });
  assert.equal(rounds, 2);
  assert.match(a.asked[1].user, /"New lesson" is not a control name/);
  assert.equal(script.steps[0].action, "click");
  assert.equal((script.steps[0] as unknown as Record<string, unknown>).extra, undefined);
  assert.equal(script.program.id, "practice-planner");
  assert.match(a.asked[0].user, /menu\.insert\.objective: "Learning objective" \(menuitem\) \[not shown at the start\]/);
});

test("a repair replaces the steps it names and keeps the rest", async () => {
  const script = { format: "openstage-studio-script", version: 2, title: "T", goal: "G", program: { id: "practice-planner", name: "Practice Planner" }, startState: { demoProject: "demo-lessons-01" },
    steps: [
      { action: "click", target: "toolbar.lesson.new", narration: "One." },
      { action: "click", target: "menu.insert.objective", narration: "Two." },
      { action: "click", target: "editor.save", narration: "Three." },
    ] } as unknown as Script;
  const a = standIn([JSON.stringify({ why: "The menu was not open.", from: 2, steps: [{ action: "click", target: "toolbar.insert", narration: "Open Insert." }, { action: "click", target: "menu.insert.objective", narration: "Two." }] })]);
  const fixed = await repairStep(a, { program, script, failed: 1, error: "The control is not on screen.", controlsNow: controls, textNow: ["Lesson title"], allControls: controls, check });
  assert.deepEqual(fixed.script.steps.map((s) => s.target), ["toolbar.lesson.new", "toolbar.insert", "menu.insert.objective", "editor.save"]);
  assert.equal(fixed.why, "The menu was not open.");
});

test("the metadata writer adds the description, tags and chapters, starting at step 1", async () => {
  const steps = Array.from({ length: 9 }, (_, i) => ({ action: "click", target: "toolbar.lesson.new", narration: `Step ${i + 1}.` }));
  const script = { title: "T", goal: "G", program: { id: "practice-planner", name: "Practice Planner" }, steps } as unknown as Script;
  const a = standIn([JSON.stringify({ description: "Plan a lesson.", tags: ["Planning", "lessons", "school"], chapters: [{ step: 2, name: "Start" }, { step: 3, name: "Write" }, { step: 4, name: "Too close" }, { step: 7, name: "Save" }] })]);
  const { script: out } = await writeMetadata(a, script);
  assert.deepEqual(out.publish, { description: "Plan a lesson.", tags: ["planning", "lessons", "school"] });
  assert.match(a.asked[0].user, /^The program: Practice Planner\./);
  // The first chapter is moved to step 1, and one too close to the one before it is dropped.
  assert.deepEqual(out.steps.map((s) => s.chapter ?? null), ["Start", null, "Write", null, null, null, "Save", null, null]);
});

test("a short script gets a description and tags but no chapters", async () => {
  const steps = Array.from({ length: 5 }, (_, i) => ({ action: "click", target: "toolbar.lesson.new", narration: `Step ${i + 1}.`, ...(i === 2 ? { chapter: "Old" } : {}) }));
  const script = { title: "T", goal: "G", program: { id: "practice-planner", name: "Practice Planner" }, steps } as unknown as Script;
  const a = standIn([JSON.stringify({ description: "Plan.", tags: ["a", "b", "c"], chapters: [{ step: 1, name: "One" }, { step: 3, name: "Two" }] })]);
  const { script: out } = await writeMetadata(a, script);
  assert.deepEqual(out.steps.map((s) => s.chapter ?? null), [null, null, null, null, null]);
});

test("rehearsal flags typing onto words a one-line box already holds, unless they were selected first", () => {
  const box = (id: string, value: string, multiline = false) => ({ id, label: "Item 1", role: "textbox", rect: [0, 0, 1, 1] as [number, number, number, number], visible: true, enabled: true, value, multiline });
  const type = { action: "type", target: "editor.checklist.item.1", value: "Coloured pencils", narration: "x" } as Step;
  assert.match(typingProblem(type, undefined, box("editor.checklist.item.1", "Diary sheets")) ?? "", /already says "Diary sheets", so typing "Coloured pencils" would add to the end of it/);
  assert.equal(typingProblem(type, undefined, box("editor.checklist.item.1", "")), null, "an empty box is fine");
  assert.equal(typingProblem(type, undefined, box("editor.notes", "Plant one bean.", true)), null, "notes take more lines");
  const selectAll = { action: "key", target: "editor.checklist.item.1", value: "Ctrl+A", narration: "x" } as Step;
  assert.equal(typingProblem(type, selectAll, box("editor.checklist.item.1", "Diary sheets")), null, "Ctrl+A first replaces the words");
  assert.notEqual(typingProblem(type, { ...selectAll, target: "editor.title" }, box("editor.checklist.item.1", "Diary sheets")), null, "Ctrl+A on another box does not count");
  assert.equal(typingProblem({ ...type, action: "click" } as Step, undefined, box("editor.checklist.item.1", "Diary sheets")), null);
});

test("numbered controls that appear later count as real", () => {
  assert.ok(fitsPattern("sidebar.lesson.12", "sidebar.lesson.*"));
  assert.equal(fitsPattern("sidebar.lesson.x", "sidebar.lesson.*"), false);
  assert.equal(fitsPattern("sidebar.lesson.", "sidebar.lesson.*"), false);
  assert.match(controlLines(controls, program), /sidebar\.lesson\.\*: lesson number \* in the list/);
});

test("a repair may reach past the failed step to fix the same problem later on", async () => {
  const script = { format: "openstage-studio-script", version: 2, title: "T", goal: "G", program: { id: "practice-planner", name: "Practice Planner" }, startState: { demoProject: "demo-lessons-01" },
    steps: [
      { action: "click", target: "toolbar.old", narration: "One." },
      { action: "type", target: "editor.title", value: "Leaves", narration: "Two." },
      { action: "click", target: "toolbar.old", narration: "Three." },
      { action: "click", target: "editor.save", narration: "Four." },
    ] } as unknown as Script;
  const a = standIn([JSON.stringify({ why: "Renamed.", from: 1, to: 3, steps: [
    { action: "click", target: "toolbar.lesson.new", narration: "One." },
    { action: "type", target: "editor.title", value: "Leaves", narration: "Two." },
    { action: "click", target: "toolbar.lesson.new", narration: "Three." },
  ] })]);
  const fixed = await repairStep(a, { program, script, failed: 0, error: "There is no control called \"toolbar.old\" on screen.", controlsNow: controls, textNow: [], allControls: controls, check });
  assert.deepEqual([fixed.from, fixed.to], [1, 3]);
  assert.deepEqual(fixed.script.steps.map((s) => s.target), ["toolbar.lesson.new", "editor.title", "toolbar.lesson.new", "editor.save"]);
});

test("a repair that repeats a step where it joins the script is tidied, not refused", async () => {
  const script = { format: "openstage-studio-script", version: 2, title: "T", goal: "G", program: { id: "practice-planner", name: "Practice Planner" }, startState: { demoProject: "demo-lessons-01" },
    steps: [
      { action: "click", target: "toolbar.lesson.new", narration: "One." },
      { action: "type", target: "editor.title", value: "Leaves", narration: "Two." },
      { action: "click", target: "editor.save", narration: "Three." },
    ] } as unknown as Script;
  // The AI repeats step 1 at the start of its repair, and step 3 at the end.
  const a = standIn([JSON.stringify({ why: "Select first.", from: 2, steps: [
    { action: "click", target: "toolbar.lesson.new", narration: "One again." },
    { action: "key", target: "editor.title", value: "Ctrl+A", narration: "Select it." },
    { action: "type", value: "Leaves", narration: "Two." },
    { action: "click", target: "editor.save", narration: "Three." },
  ] })]);
  const fixed = await repairStep(a, { program, script, failed: 1, error: "x", controlsNow: controls, textNow: [], allControls: controls, check });
  assert.deepEqual(fixed.script.steps.map((s) => `${s.action} ${s.target ?? ""}`), ["click toolbar.lesson.new", "key editor.title", "type ", "click editor.save"]);
  assert.equal(fixed.rounds, 1);
  assert.deepEqual(collapseRepeats([{ action: "key", value: "Tab" }, { action: "key", value: "Tab" }] as Step[]).length, 2, "repeated keys are kept");
});

test("stray values from the AI are tidied before the check", () => {
  assert.deepEqual(cleanStep({ action: "TYPE", target: "editor.title", value: 30, narration: "x", expect: "", junk: 1 }), { action: "type", target: "editor.title", value: "30", narration: "x" });
});

test("a hosted choice says what it still needs, and never shows the key", () => {
  assert.match(missing({ choice: "hosted", preset: "claude" }) ?? "", /key/);
  assert.match(missing({ choice: "hosted", preset: "chatgpt", key: "k" }) ?? "", /model/);
  assert.equal(missing({ choice: "hosted", preset: "claude", key: "k" }), null);
  assert.equal(describeChoice({ choice: "hosted", preset: "claude", key: "secret" }).includes("secret"), false);
  assert.equal(describeChoice({ choice: "hosted", preset: "claude", key: "k" }), "Claude (Anthropic), model claude-opus-5-5");
});
