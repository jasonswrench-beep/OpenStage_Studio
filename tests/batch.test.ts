import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectScripts, isRepairedCopy } from "../src/batch/scripts.ts";
import { expectedBreak } from "../src/batch/check-batch.ts";
import { queueText } from "../src/batch/queue.ts";
import { releaseText } from "../src/batch/release.ts";
import { formatOnly, stepWords } from "../src/batch/check-script.ts";
import { programVersion, VERSION_2_CHANGES } from "../sample-program/versions.ts";
import type { Script } from "../src/script/format.ts";

const script = (steps: unknown[]) => ({
  format: "openstage-studio-script", version: 2, title: "T", goal: "G", program: { id: "practice-planner", name: "Practice Planner" },
  startState: { demoProject: "demo-lessons-01" }, steps,
});
const click = (target: string) => ({ action: "click", target, narration: "x" });

test("scripts are found in series (by their plan), in folders and as files, but never repaired copies", () => {
  const base = mkdtempSync(join(tmpdir(), "studio-batch-"));
  try {
    const series = join(base, "series", "practice-planner-planning");
    mkdirSync(series, { recursive: true });
    writeFileSync(join(series, "plan.json"), JSON.stringify({ videos: [
      { title: "One", status: "proposed", script: "01-one.json" },
      { title: "Cut", status: "cut", script: "02-cut.json" },
      { title: "Not written", status: "proposed" },
    ] }));
    for (const f of ["01-one.json", "02-cut.json", "01-one.repaired.json"]) writeFileSync(join(series, f), JSON.stringify(script([click("toolbar.lesson.new")])));
    const loose = join(base, "loose");
    mkdirSync(loose);
    writeFileSync(join(loose, "a.json"), JSON.stringify(script([click("toolbar.lesson.new")])));
    writeFileSync(join(loose, "bad.json"), JSON.stringify({ ...script([]), title: "" }));
    writeFileSync(join(loose, "studio-project.json"), JSON.stringify({ voice: {} }));
    const found = collectScripts([join(base, "series"), loose, join(loose, "a.json")]);
    assert.deepEqual(found.map((e) => [e.renderName, !!e.script, e.series?.video ?? null]), [
      ["practice-planner-planning-01-one", true, "One"],
      ["a", true, null],
      ["bad", false, null],
    ]);
    assert.ok(isRepairedCopy("05-copy.repaired.json"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the release check's expected break is the first step that needs a renamed control, callouts included", () => {
  const renamed = VERSION_2_CHANGES.map((c) => c.was);
  assert.equal(expectedBreak(script([click("toolbar.lesson.new"), click("toolbar.settings"), click("editor.checklist.add")]) as unknown as Script, renamed), 2);
  assert.equal(expectedBreak(script([click("toolbar.lesson.new"), { ...click("editor.save"), callout: { type: "box", around: "editor.checklist.add" } }]) as unknown as Script, renamed), 2);
  assert.equal(expectedBreak(script([click("toolbar.lesson.new")]) as unknown as Script, renamed), null);
  assert.equal(expectedBreak(script([{ action: "open", value: "toolbar.settings", narration: "x" }]) as unknown as Script, renamed), null);
});

test("the practice program's version comes from its shell, and is 1 unless said", () => {
  assert.equal(programVersion({}), 1);
  assert.equal(programVersion({ __PRACTICE_PLANNER_VERSION__: 2 }), 2);
  assert.equal(programVersion({ __PRACTICE_PLANNER_VERSION__: "x" }), 1);
});

test("the reports name the broken step, its words and the repaired copy, and say what comes next", () => {
  const s = script([click("toolbar.lesson.new"), click("toolbar.settings")]) as unknown as Script;
  const entry = { file: "C:\\x\\series\\p\\06-share.json", script: s, renderName: "p-06-share", series: { folder: "C:\\x\\series\\p", video: "Share a lesson" } };
  const check = { works: false, broken: { step: 2, what: s.steps[1], error: "There is no control called \"toolbar.settings\" on screen." }, repairedFile: "C:\\x\\series\\p\\06-share.repaired.json" };
  const rel = releaseText([{ entry, check }, { entry: { ...entry, file: "C:\\x\\a.json" }, check: { works: true } }], "Claude (Anthropic)");
  assert.match(rel, /1 still work, 1 broken, 0 not checked/);
  assert.match(rel, /06-share\.json \("Share a lesson"\), step 2: click toolbar\.settings/);
  assert.match(rel, /A repaired copy passed rehearsal: .*06-share\.repaired\.json/);
  const q = queueText([{ entry, outcome: "broken", check }, { entry, outcome: "recorded", video: "C:\\x\\renders\\p\\v.mp4", review: "Export is shut: 1 flag not decided yet." }], [{ title: "About this guide", videos: 0, note: "no tasks with steps" }], "no AI");
  assert.match(q, /1 recorded now, 0 already made, 1 broken/);
  assert.match(q, /About this guide: 0 video\(s\) \(no tasks with steps\)/);
  assert.match(q, /Next: review each new video/);
  assert.equal(stepWords({ action: "type", target: "editor.title", value: "Leaves", narration: "x" }), 'type editor.title "Leaves"');
  assert.deepEqual(formatOnly(s), []);
});
