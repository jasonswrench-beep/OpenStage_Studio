import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { keyChord, recordingToScript, studioRole, typedCharacter, type LogLine, type Recording } from "../src/recording/to-script.ts";
import { findControl } from "../src/recording/import.ts";
import { PROGRAMS } from "../src/pipeline/programs.ts";
import { validateScript } from "../src/script/validate.ts";

const ROOT = resolve(import.meta.dirname, "..");
const EXAMPLE = join(ROOT, "examples", "recordings", "plan-a-lesson.capture");

/** The example recording as the helper reports it. (Studio reads recordings with the shared core's reader, in the
 * helper; this test only needs the same shape, so it reads the example's files itself and skips the cut-off last line.) */
function example(): Recording {
  const manifest = JSON.parse(readFileSync(join(EXAMPLE, "capture.json"), "utf8"));
  const take = JSON.parse(readFileSync(join(EXAMPLE, "takes", "take-001", "take.json"), "utf8"));
  const lines = readFileSync(join(EXAMPLE, "takes", "take-001", "events.jsonl"), "utf8").split(/\r?\n/).flatMap((l) => {
    try {
      return [JSON.parse(l) as LogLine];
    } catch {
      return [];
    }
  });
  return { title: manifest.title, language: manifest.language, schemaVersion: manifest.schemaVersion, takes: [{ id: 1, readable: true, state: take.state, durationMs: take.durationMs, interactions: take.media[0].interactions, lines }] };
}

test("the recorder's role words become Studio's, and the keys become characters or chords", () => {
  assert.equal(studioRole("combo box"), "combobox");
  assert.equal(studioRole("Edit"), "textbox");
  assert.equal(studioRole("pane"), null);
  assert.equal(typedCharacter("s", ["shift"]), "S");
  assert.equal(typedCharacter("1", ["shift"]), "!");
  assert.equal(typedCharacter("period", []), ".");
  assert.equal(typedCharacter("quote", ["shift"]), '"');
  assert.equal(typedCharacter("s", ["ctrl"]), null);
  assert.equal(keyChord("s", ["ctrl"]), "Ctrl+S");
  assert.equal(keyChord("enter", []), "Enter");
  assert.equal(keyChord("f5", ["shift"]), "Shift+F5");
  assert.equal(keyChord("d", ["win"]), null);
});

test("the example recording becomes a draft script: clicks, typing with a correction, chosen list items, chapters, a shortcut", () => {
  const d = recordingToScript(example(), PROGRAMS);
  assert.equal(d.program.id, "practice-planner");
  assert.equal(d.take, 1);
  const s = d.script;
  assert.equal(s.title, "Plan a lesson");
  assert.equal(s.startState.demoProject, "demo-lessons-01");
  const brief = s.steps.map((x) => [x.action, x.fallback?.name ?? null, x.value ?? null]);
  assert.deepEqual(brief, [
    ["click", "New lesson", null],
    ["type", "Lesson title", "Sorting leaves by shape"],
    ["type", "Subject", "Science"],
    ["type", "Length", "30 minutes"],
    ["type", "Notes", "Collect ten leaves."],
    ["click", "Lesson settings", null],
    ["click", "Share this lesson with the class page", null],
    ["click", "OK", null],
    ["key", null, "Ctrl+S"],
  ]);
  assert.equal(s.steps[0].chapter, "Start a lesson");
  assert.equal(s.steps[4].chapter, "Write the plan");
  assert.equal(s.steps[5].chapter, "Share and save");
  assert.equal(s.steps[2].narration, "In the Subject list, choose Science.");
  assert.equal(s.steps[2].fallback?.role, "combobox");
  assert.ok(s.steps.every((x) => x.narration && x.expect), "every step has plain narration and what must be true afterward");
  // What was left out, in words.
  assert.ok(d.notes.some((n) => /without a name \(at 1700, 950\)/.test(n)));
  assert.ok(d.notes.some((n) => /otherapp\.exe came in front/.test(n)));
  assert.ok(!s.steps.some((x) => x.fallback?.name === "Dismiss"), "nothing done in another program is kept");
  assert.ok(!JSON.stringify(s).includes("Notification"), "window titles are not copied into the script");
  // The draft passes the format check once the hook has given each step its id (simulated here).
  const withIds = { ...s, steps: s.steps.map((x, i) => (x.fallback ? { ...x, target: `c${i}`, fallback: undefined } : x)) };
  assert.ok(validateScript(JSON.parse(JSON.stringify(withIds))).ok);
});

test("a recording whose keys were left out, or made in a program Studio does not know, says so", () => {
  const r = example();
  r.takes[0].interactions = { display: 1, keys: false };
  r.takes[0].lines = r.takes[0].lines!.filter((l) => l.type !== "key");
  const d = recordingToScript(r, PROGRAMS);
  assert.ok(d.notes.some((n) => /left the keys out/.test(n)));
  assert.equal(d.script.steps[1].action, "click", "a click into a box with nothing typed stays a click");
  const other = example();
  other.takes[0].lines = other.takes[0].lines!.map((l) => (l.type === "window" ? { ...l, title: "Some editor", process: "editor.exe" } : l));
  assert.throws(() => recordingToScript(other, PROGRAMS), /not made in a program Studio can perform/);
  const empty = example();
  empty.takes[0].lines = [];
  assert.throws(() => recordingToScript(empty, PROGRAMS), /no take with clicks/);
});

test("on screen, the control with the recorded role and name is found, the visible one first", () => {
  const c = (id: string, label: string, role: string, visible = true) => ({ id, label, role, rect: [0, 0, 1, 1] as [number, number, number, number], visible, enabled: true });
  const controls = [c("a", "OK", "button", false), c("b", "OK", "button"), c("t", "Lesson  title", "textbox")];
  assert.equal(findControl(controls, "button", "ok")?.id, "b");
  assert.equal(findControl(controls, "textbox", "Lesson title")?.id, "t");
  assert.equal(findControl(controls, "checkbox", "OK"), undefined);
});
