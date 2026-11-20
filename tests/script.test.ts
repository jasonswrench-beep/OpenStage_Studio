import { SCRIPT_VERSION } from "../src/script/format.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseKey, parseScroll } from "../src/script/format.ts";
import { describeProblems, looksLikePath, sentenceCount, validateScript } from "../src/script/validate.ts";

const good = () => ({
  format: "openstage-studio-script",
  version: SCRIPT_VERSION,
  title: "Add a lesson",
  goal: "Make a new lesson.",
  program: { id: "practice-planner", name: "Practice Planner" },
  startState: { demoProject: "demo-lessons-01" },
  steps: [
    { action: "click", target: "toolbar.lesson.new", narration: "Select New lesson.", expect: "A lesson is selected" },
    { action: "type", target: "editor.title", value: "Leaves", narration: "Type a title.", expect: "The title is Leaves" },
  ],
});

const paths = (v: ReturnType<typeof validateScript>) => v.errors.map((e) => e.path);

test("a well-formed script passes and counts as rehearsed when every step has an expect", () => {
  const v = validateScript(good());
  assert.equal(v.ok, true, describeProblems(v).join("\n"));
  assert.equal(v.rehearsable, true);
  assert.ok(v.script);
});

test("the example script in the repository passes", () => {
  const v = validateScript(JSON.parse(readFileSync("examples/plan-a-lesson.json", "utf8")));
  assert.deepEqual(describeProblems(v), []);
  assert.equal(v.rehearsable, true);
});

test("a step with no narration that is not marked silent is refused, so no dead air slips in", () => {
  const s = good();
  delete (s.steps[0] as { narration?: string }).narration;
  const v = validateScript(s);
  assert.equal(v.ok, false);
  assert.deepEqual(paths(v), ["steps[0].narration"]);
  (s.steps[0] as { silent?: boolean }).silent = true;
  assert.equal(validateScript(s).ok, true, "silent on purpose is fine");
});

test("narration and silent together are refused", () => {
  const s = good();
  (s.steps[0] as { silent?: boolean }).silent = true;
  assert.deepEqual(paths(validateScript(s)), ["steps[0]"]);
});

test("the starting state must name a demo project, never a file path", () => {
  for (const p of ["C:\\Users\\someone\\lesson.plan", "/home/a/b", "../x", "~/demo"]) {
    const s = good();
    s.startState.demoProject = p;
    const v = validateScript(s);
    assert.equal(v.ok, false, p);
    assert.match(v.errors[0].message, /file path/);
  }
  assert.equal(looksLikePath("demo-lessons-01"), false);
});

test("an open step names a demo project, not a path", () => {
  const s = good();
  s.steps.push({ action: "open", value: "D:\\real\\course.zip", narration: "Open it." } as never);
  assert.deepEqual(paths(validateScript(s)), ["steps[2].value"]);
});

test("unknown fields and misspellings are errors, so typos do not pass silently", () => {
  const s = good() as Record<string, unknown>;
  s.titel = "x";
  (s.steps as Record<string, unknown>[])[0].narraton = "x";
  const v = validateScript(s);
  assert.ok(paths(v).includes("titel"));
  assert.ok(paths(v).includes("steps[0].narraton"));
});

test("each action checks what it needs", () => {
  const s = good();
  s.steps = [
    { action: "click", narration: "a" } as never,
    { action: "type", target: "editor.title", narration: "b" } as never,
    { action: "key", value: "Ctrl+Q+Z", narration: "c" } as never,
    { action: "scroll", value: "sideways", narration: "d" } as never,
    { action: "drag", target: "canvas.box", narration: "e" } as never,
    { action: "wait", value: "45", narration: "f" } as never,
    { action: "jump", narration: "g" } as never,
  ];
  assert.deepEqual(paths(validateScript(s)), ["steps[0].target", "steps[1].value", "steps[2].value", "steps[3].value", "steps[4].action", "steps[5].value", "steps[6].action"]);
});

test("a click may name words inside its control, and only a click with the hook may", () => {
  const s = good();
  s.steps.push({ action: "click", target: "editor.notes", words: "ten leaves", narration: "Select ten leaves." } as never);
  assert.equal(validateScript(s).ok, true, describeProblems(validateScript(s)).join("\n"));
  s.steps.push({ action: "type", target: "editor.title", value: "x", words: "Leaves", narration: "Type." } as never);
  s.steps.push({ action: "click", target: "editor.notes", words: "  ", narration: "Select." } as never);
  assert.deepEqual(paths(validateScript(s)), ["steps[3].words", "steps[4].words"]);
  const a = { ...good(), driver: "accessibility" };
  a.steps = [{ action: "click", target: "editor.notes", words: "ten", narration: "Select ten." } as never];
  assert.deepEqual(paths(validateScript(a)), ["steps[0].words"]);
});

test("a click on words may put the cursor before or after them instead of selecting them", () => {
  const s = good();
  s.steps.push({ action: "click", target: "editor.notes", words: "leaves", caret: "after", narration: "Click after leaves." } as never);
  assert.equal(validateScript(s).ok, true, describeProblems(validateScript(s)).join("\n"));
  s.steps.push({ action: "click", target: "editor.notes", caret: "before", narration: "Click." } as never);
  s.steps.push({ action: "click", target: "editor.notes", words: "ten", caret: "inside", narration: "Click." } as never);
  assert.deepEqual(paths(validateScript(s)), ["steps[3].caret", "steps[4].caret"]);
});

test("a wait may name a control to wait for; an open step may not name one", () => {
  const s = good();
  s.steps.push({ action: "wait", target: "editor.title", value: "1", narration: "It is done." } as never);
  assert.equal(validateScript(s).ok, true, describeProblems(validateScript(s)).join("\n"));
  s.steps.push({ action: "wait", target: "not a name", narration: "Wait." } as never);
  s.steps.push({ action: "open", target: "editor.title", value: "demo-empty", narration: "Open." } as never);
  assert.deepEqual(paths(validateScript(s)), ["steps[3].target", "steps[4].target"]);
});

test("targets must be stable names, and must exist when the program's control list is given", () => {
  const s = good();
  s.steps[0].target = "New lesson button";
  assert.deepEqual(paths(validateScript(s)), ["steps[0].target"]);
  const t = good();
  const v = validateScript(t, { controls: ["toolbar.lesson.new"] });
  assert.deepEqual(paths(v), ["steps[1].target"]);
  assert.match(v.errors[0].message, /no control called "editor.title"/);
});

test("callouts are checked by type", () => {
  const s = good();
  (s.steps[0] as Record<string, unknown>).callout = { type: "label", text: "x".repeat(61), near: "toolbar.lesson.new" };
  (s.steps[1] as Record<string, unknown>).callout = { type: "circle", around: "a" };
  assert.deepEqual(paths(validateScript(s)), ["steps[0].callout.text", "steps[1].callout.type"]);
});

test("long narration is a warning, not an error", () => {
  const s = good();
  s.steps[0].narration = "One. Two. Three.";
  const v = validateScript(s);
  assert.equal(v.ok, true);
  assert.equal(v.warnings[0].path, "steps[0].narration");
  assert.equal(sentenceCount("Select it. Then type. Done!"), 3);
});

test("a script without expect on every step passes but is not rehearsed", () => {
  const s = good();
  delete (s.steps[1] as { expect?: string }).expect;
  const v = validateScript(s);
  assert.equal(v.ok, true);
  assert.equal(v.rehearsable, false);
});

test("a newer format version says so plainly", () => {
  const s = good();
  s.version = SCRIPT_VERSION + 1;
  assert.match(validateScript(s).errors[0].message, /newer OpenStage Studio/);
});

test("the position driver is named but not built yet", () => {
  const s = { ...good(), driver: "position" };
  assert.match(validateScript(s).errors[0].message, /not built yet/);
});

test("an accessibility script clicks, types and waits, and may find a control by role and name", () => {
  const base = { ...good(), driver: "accessibility" };
  assert.equal(validateScript(base).ok, true, describeProblems(validateScript(base)).join("\n"));
  const byName = { ...base, steps: [{ action: "click", fallback: { role: "button", name: "Weather diary Science · 25 min" }, narration: "Open it." }] };
  assert.equal(validateScript(byName).ok, true, describeProblems(validateScript(byName)).join("\n"));
  const keys = { ...base, steps: [{ action: "key", value: "Ctrl+S", narration: "Save." }, { action: "open", value: "demo-empty", narration: "Open." }] };
  assert.deepEqual(paths(validateScript(keys)), ["steps[0].action", "steps[1].action"]);
  assert.match(validateScript(keys).errors[0].message, /never uses the real keyboard/);
  const nothing = { ...base, steps: [{ action: "click", narration: "Click something." }] };
  assert.deepEqual(paths(validateScript(nothing)), ["steps[0].target"]);
});

test("keys and scroll amounts are read the same way everywhere", () => {
  assert.deepEqual(parseKey("Ctrl+S"), { modifiers: ["Ctrl"], key: "S" });
  assert.deepEqual(parseKey("Shift+Tab"), { modifiers: ["Shift"], key: "Tab" });
  assert.equal(parseKey("Ctrl+Ctrl+S"), null);
  assert.equal(parseKey("Hyper+S"), null);
  assert.equal(parseKey("F13"), null);
  assert.deepEqual(parseScroll("up 120"), { axis: "y", amount: -120 });
  assert.deepEqual(parseScroll(undefined), { axis: "y", amount: 300 });
  assert.equal(parseScroll("down lots"), null);
});

test("anything that is not an object is refused with a plain message", () => {
  assert.equal(validateScript(null).ok, false);
  assert.equal(validateScript([]).ok, false);
  assert.equal(validateScript("script").errors.length, 1);
});

test("a version 1 script is brought up to the current version and still passes", () => {
  const s = good() as unknown as Record<string, unknown>;
  s.version = 1;
  const v = validateScript(s);
  assert.equal(v.ok, true);
  assert.equal(v.script?.version, SCRIPT_VERSION);
  assert.equal(v.warnings[0].path, "version");
});

test("blurred boxes and publishing details are checked", () => {
  const s = good() as unknown as Record<string, unknown>;
  s.redactions = [{ box: [100, 200, 300, 40], fromStep: 0, toStep: 1, reason: "a path" }];
  s.publish = { description: "Plan a lesson.", tags: ["lesson planning"], thumbnailStep: 1 };
  assert.equal(validateScript(s).ok, true);
  s.redactions = [{ box: [1800, 0, 300, 40], fromStep: 2, toStep: 1 }];
  s.publish = { thumbnailStep: 99 };
  const paths = validateScript(s).errors.map((e) => e.path);
  assert.deepEqual(paths, ["publish.thumbnailStep", "redactions[0].box", "redactions[0].toStep"]);
});

test("a blurred box is added to a script without disturbing its layout", async () => {
  const { addRedaction } = await import("../src/script/edit.ts");
  const text = readFileSync("examples/guard/planted-path.json", "utf8");
  const box = { box: [697, 401, 566, 38] as [number, number, number, number], fromStep: 1, toStep: 2, reason: "a user folder (flag 5e1231b4)" };
  const once = addRedaction(text, box);
  // Everything else is untouched: only the new lines differ.
  const added = once.split("\n").filter((l) => !text.split("\n").includes(l));
  assert.deepEqual(added.map((l) => l.trim()), ['"redactions": [', '{ "box": [697, 401, 566, 38], "fromStep": 1, "toStep": 2, "reason": "a user folder (flag 5e1231b4)" }', "],"]);
  assert.equal(validateScript(JSON.parse(once)).script?.redactions?.length, 1);
  assert.equal(addRedaction(once, box), once, "the same box is not added twice");
  const twice = addRedaction(once, { ...box, box: [10, 10, 50, 20] });
  assert.equal(validateScript(JSON.parse(twice)).script?.redactions?.length, 2);
  const old = JSON.stringify({ ...JSON.parse(text), version: 1 }, null, 2);
  assert.equal(JSON.parse(addRedaction(old, box)).version, SCRIPT_VERSION, "an older script is brought up to date");
});
