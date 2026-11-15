import test from "node:test";
import assert from "node:assert/strict";
import { checklistText, contrast, makeDescription, makeDraft, packageFolderName, thumbnailPlan, uploadText } from "../src/package/package.ts";
import type { Script } from "../src/script/format.ts";

const script = {
  format: "openstage-studio-script", version: 2, title: "Plan a new lesson", goal: "Make a lesson plan.",
  program: { id: "practice-planner", name: "Practice Planner" }, startState: { demoProject: "demo-lessons-01" },
  playlist: { name: "Practice Planner basics", position: 3 },
  publish: { description: "Plan a lesson from a blank page.", tags: ["lesson planning", "practice planner"] },
  steps: [{ action: "click", target: "toolbar.lesson.new", narration: "Select New lesson." }],
} as unknown as Script;
const chapters = "0:00 Start a lesson\n0:24 Write the notes\n1:02 Save and share\n";

test("the package folder is numbered by playlist position", () => {
  assert.equal(packageFolderName(script, "plan-a-lesson"), "03-plan-a-lesson");
  assert.equal(packageFolderName({ ...script, playlist: undefined }, "Plan A Lesson!"), "00-plan-a-lesson");
});

test("the description has the script's words, the chapters (three or more), and the narration line only when switched on", () => {
  const d = makeDescription(script, chapters);
  assert.match(d, /^Plan a lesson from a blank page\.\n\nChapters\n0:00 Start a lesson/);
  assert.doesNotMatch(d, /computer generated/);
  assert.match(makeDescription(script, chapters, { disclosureLine: true }), /The narration in this video is computer generated\./);
  assert.doesNotMatch(makeDescription(script, "0:00 Introduction\n"), /Chapters/);
});

test("upload.txt and the checklist say what to do, in playlist order", () => {
  const { folderName, ...draft } = makeDraft(script, "plan-a-lesson", chapters, "computer generated (Kokoro voice af_heart)");
  const record = { ...draft, approvedBy: "Test Reviewer" };
  const text = uploadText(record);
  assert.match(text, /Title:\nPlan a new lesson/);
  assert.match(text, /Tags: lesson planning, practice planner/);
  assert.match(text, /Playlist: Practice Planner basics, position 3/);
  assert.match(text, /upload captions\.srt as the video's caption track/);
  assert.match(text, /Approved for upload by Test Reviewer\./);
  const list = checklistText([{ folder: "05-later", record }, { folder: folderName, record }]);
  assert.ok(list.indexOf("03-plan-a-lesson") < list.indexOf("05-later"));
});

test("thumbnail colours get a contrast check that warns and never blocks", () => {
  assert.ok(contrast("#FFFFFF", "#000000") > 20);
  const low = thumbnailPlan(script, { background: "#777777", color: "#888888" }, null, null, []);
  assert.equal(low.warnings.length, 2);
  assert.equal(low.plan.background, "#777777");
  const bad = thumbnailPlan(script, { background: "navy" }, null, null, []);
  assert.equal(bad.plan.background, "#102037");
  assert.equal(thumbnailPlan(script, undefined, null, null, []).warnings.length, 0);
});
