import test from "node:test";
import assert from "node:assert/strict";
import { approve, carryDecisions, decide, flagState, gate, guardReport, REVIEW_FORMAT, type Review } from "../src/guard/review.ts";
import type { Flag } from "../src/guard/frame-scan.ts";

const flag = (id: string, covered = false): Flag => ({
  id, term: "a user folder", category: "path", found: "C:\Users\dana.whitfield", how: "pattern", rect: [700, 400, 550, 22],
  shown: [[137, 270]], steps: [1, 2], sightings: [{ picture: "p1", source: "picture", text: "x", found: "x", how: "pattern", rect: [700, 400, 550, 22] }], covered,
});
const review = (flags: Flag[]): Review => ({
  format: REVIEW_FORMAT, version: 1, video: "v.mp4", videoDigest: "abc", script: "s.json", title: "T", fps: 30, narration: "computer generated", writtenBy: "a person",
  scans: { script: { ran: true, checked: 5, hits: 0 }, frames: { ran: true, pictures: 5, read: "text recognition", pageText: true }, blocklist: { terms: 2, patterns: true, files: [] } },
  flags, decisions: {},
});

test("export is shut while any flag is open, and opens only after a person approves", () => {
  let r = review([flag("a"), flag("b")]);
  assert.equal(gate(r).open, false);
  assert.throws(() => approve(r, "Test Reviewer", "today"), /Export is shut: 2 flags not decided yet/);
  r = decide(r, "a", "approve", "Test Reviewer", "today");
  assert.equal(gate(r).resolved, false);
  r = decide(r, "b", "approve", "Test Reviewer", "today");
  assert.equal(gate(r).resolved, true);
  assert.equal(gate(r).open, false, "resolved is not enough: a person must approve the video");
  r = approve(r, "Test Reviewer", "today");
  assert.equal(gate(r).open, true);
});

test("a blur counts only once the video has it; record again keeps export shut", () => {
  let r = review([flag("a")]);
  r = decide(r, "a", "blur", "Test Reviewer", "today");
  assert.equal(flagState(r.flags[0], r.decisions.a), "blur-pending");
  assert.match(gate(r).says, /1 blur waiting for the video to be made again/);
  assert.equal(flagState(flag("a", true), undefined), "blurred");
  assert.equal(gate(review([flag("a", true)])).resolved, true);
  r = decide(r, "a", "rerecord", "Test Reviewer", "today");
  assert.match(gate(r).says, /1 flag to be recorded again/);
});

test("every decision needs a name, and changing one takes back the approval", () => {
  let r = review([flag("a")]);
  assert.throws(() => decide(r, "a", "approve", "  ", "today"), /Say who is deciding/);
  r = approve(decide(r, "a", "approve", "Test Reviewer", "today"), "Test Reviewer", "today");
  r = decide(r, "a", "rerecord", "Test Reviewer", "later");
  assert.equal(r.approval, undefined);
});

test("decisions carry to a new run with the same pictures, but the approval never does", () => {
  const before = approve(decide(review([flag("a")]), "a", "approve", "Test Reviewer", "today"), "Test Reviewer", "today");
  const after = carryDecisions(review([flag("a"), flag("c")]), before);
  assert.equal(after.decisions.a.carried, true);
  assert.equal(after.decisions.c, undefined);
  assert.equal(after.approval, undefined);
});

test("the guard report says what ran, what was found and who decided", () => {
  const r = approve(decide(review([flag("a")]), "a", "approve", "Test Reviewer", "15 Nov", "it is invented"), "Test Reviewer", "15 Nov");
  const text = guardReport(r);
  assert.match(text, /Script scan: 5 pieces of text checked, 0 hits/);
  assert.match(text, /Frame scan: 5 pictures read with text recognition, and the text each page reported/);
  assert.match(text, /First shown at 0:04\.6 \(frame 137\), steps 1 to 2/);
  assert.match(text, /Resolution: Approved: may show, decided by Test Reviewer on 15 Nov: it is invented\./);
  assert.match(text, /Approved for export by Test Reviewer on 15 Nov\./);
});
