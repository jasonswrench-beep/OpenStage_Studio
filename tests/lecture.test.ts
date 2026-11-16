import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Lecture } from "../src/lecture/format.ts";
import { approvalState, approve, lectureDigest } from "../src/lecture/approval.ts";
import { validateLecture } from "../src/lecture/validate.ts";
import { notesToLecture, chapterToLecture } from "../src/lecture/write.ts";
import { lectureToScript, slideDescription } from "../src/lecture/make-lecture.ts";
import { endCard, LECTURE_PROGRAM } from "../src/timeline/build.ts";
import { addRedaction } from "../src/script/edit.ts";
import { scriptTexts } from "../src/guard/script-scan.ts";

const ROOT = resolve(import.meta.dirname, "..");
const EXAMPLE = join(ROOT, "examples", "lectures");
const example = () => JSON.parse(readFileSync(join(EXAMPLE, "how-seeds-become-plants.json"), "utf8")) as Lecture;

test("the example lecture passes the check, and its notes give the same slides by Studio's rules", () => {
  const l = example();
  const c = validateLecture(l);
  assert.ok(c.ok, JSON.stringify(c.errors));
  const fromNotes = notesToLecture(readFileSync(join(EXAMPLE, "how-seeds-become-plants.md"), "utf8"));
  assert.equal(fromNotes.title, "How seeds become plants");
  assert.deepEqual(fromNotes.slides, l.slides);
  assert.deepEqual(fromNotes.slides[3].points, ["Fold a damp paper towel inside each cup", "Press a bean seed between the towel and the cup", "Keep two cups warm and one cup in the cold", "Draw what you see every morning for a week"]);
});

test("notes with more than six points continue on a second slide, and every slide has narration", () => {
  const notes = "# Seven\n\n## Many points\n\n" + [1, 2, 3, 4, 5, 6, 7].map((n) => `- Point ${n}`).join("\n");
  const l = notesToLecture(notes);
  assert.deepEqual(l.slides.map((s) => [s.title, s.points?.length]), [["Many points", 6], ["Many points (continued)", 1]]);
  assert.ok(l.slides.every((s) => s.narration.length > 0));
  assert.ok(validateLecture(l).ok);
});

test("a manual's chapter gives one slide per topic, its steps as points", () => {
  const chapter = {
    id: "c1", title: "Planning lessons",
    topics: [
      { id: "t0", title: "Planning lessons", depth: 0, text: "Lessons hold your plans.", procedures: [] },
      { id: "t1", title: "Make a lesson", depth: 1, text: "A new lesson starts empty.", procedures: [[{ text: "Select [[New lesson]]." }, { text: "Type a title." }]] },
    ],
  };
  const l = chapterToLecture("Practice Planner Guide", chapter);
  assert.equal(l.course, "Practice Planner Guide");
  assert.deepEqual(l.slides[1], { title: "Make a lesson", points: ["Select New lesson.", "Type a title."], narration: "A new lesson starts empty.", chapter: "Make a lesson" });
});

test("the check catches a crowded or careless slide in words", () => {
  const bad = { ...example(), slides: [{ title: "x".repeat(81), points: Array(7).fill("p"), picture: "../secret.png", narration: "" }] };
  const msgs = validateLecture(bad).errors.map((e) => `${e.path}: ${e.message}`).join("\n");
  assert.match(msgs, /title is at most 80/);
  assert.match(msgs, /at most six points/);
  assert.match(msgs, /never a path/);
  assert.match(msgs, /says what the picture shows/);
  assert.match(msgs, /has narration/);
});

test("every lecture waits for a person's approval, and a change to its words needs a new one; a blurred box does not", () => {
  const l = example();
  assert.equal(approvalState(l).ok, false);
  const a = approve(l, "A teacher", "16 Nov 2026, 09:00");
  assert.equal(approvalState(a).ok, true);
  assert.equal(a.approval!.digest, lectureDigest(l));
  const edited = { ...a, slides: [{ ...a.slides[0], narration: "Changed." }, ...a.slides.slice(1)] };
  assert.match(approvalState(edited).says, /changed since/);
  const boxed = JSON.parse(addRedaction(JSON.stringify(a, null, 2), { box: [10, 10, 100, 40], fromStep: 1, toStep: 1, reason: "a name" })) as Lecture;
  assert.equal(boxed.version, 1, "a lecture keeps its own version");
  assert.deepEqual(boxed.redactions?.[0].box, [10, 10, 100, 40]);
  assert.equal(approvalState(boxed).ok, true, "a box chosen in review leaves the approval standing");
  assert.throws(() => approve(l, "  ", "now"), /name of the person/);
});

test("a lecture is made as a tutorial-shaped script: one step per slide, its slide described, a lecture's end card", () => {
  const l = example();
  const s = lectureToScript(l);
  assert.equal(s.program.id, LECTURE_PROGRAM);
  assert.equal(s.program.name, "Science with Year 4");
  assert.equal(s.steps.length, l.slides.length);
  assert.ok(s.steps.every((x) => x.action === "wait" && x.value === "0"));
  assert.equal(s.steps[0].narration, l.slides[0].narration);
  assert.equal(slideDescription(l.slides[0], 1), "Slide 1: What a seed holds. Points: A tough seed coat keeps it safe and dry; The embryo is the young plant itself; The stored food feeds it before it has leaves.");
  assert.deepEqual(endCard(s).lines, ["The transcript has everything said and shown."]);
  // Everything a viewer sees or hears is scanned: the points and the course name too.
  const scanned = scriptTexts(l as unknown as Record<string, unknown>).map((t) => t.path);
  assert.ok(scanned.includes("slides[0].points[0]") && scanned.includes("course"));
});
