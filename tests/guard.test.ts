import test from "node:test";
import assert from "node:assert/strict";
import { findHits, makeBlocklist, normal, starterBlocklistFile } from "../src/guard/blocklist.ts";
import { scanScript } from "../src/guard/script-scan.ts";

// Invented names only: none of these is a real product.
const { list } = makeBlocklist([{ byCategory: { product: ["Quillmark Studio", "Zentrova"], institution: ["Harrowgate College"] }, allow: ["Quillmark Notes"] }],
  { userName: "morgan.ellery", homeFolder: "C:\\Users\\morgan.ellery", computerName: "DESK-7Q" });

const terms = (text: string) => findHits(text, list).map((h) => h.term);

test("a blocked name is found whatever its case and spacing", () => {
  assert.deepEqual(terms("Open it in quillmark studio first."), ["Quillmark Studio"]);
  assert.deepEqual(terms("QUILLMARK-STUDIO"), ["Quillmark Studio"]);
  assert.deepEqual(terms("Quill mark Studio"), ["Quillmark Studio"]);
});

test("a misread name is still found", () => {
  assert.deepEqual(terms("Zentr0va"), ["Zentrova"]);
  assert.deepEqual(terms("Quiilmark Studlo"), ["Quillmark Studio"]);
  assert.deepEqual(terms("Harrovvgate Co1lege"), ["Harrowgate College"]);
});

test("a name cut off at the edge of the text is found", () => {
  const hits = findHits("Saved by Quillmark Stu", list);
  assert.equal(hits[0]?.term, "Quillmark Studio");
  assert.equal(hits[0]?.how, "partial");
});

test("ordinary words and allowlisted names are not flagged", () => {
  assert.deepEqual(terms("Add a lesson title, then press Save."), []);
  assert.deepEqual(terms("Made with OpenStage Author and Quillmark Notes."), []);
});

test("this computer's user name and home folder are blocked", () => {
  assert.deepEqual(terms("Signed in as morgan.ellery"), ["morgan.ellery"]);
  const paths = findHits("Saved to C:\\Users\\morgan.ellery\\Documents\\week1.txt", list).filter((h) => h.how === "pattern");
  assert.equal(paths.length, 1, "a user folder inside a full path is one hit");
  assert.equal(paths[0].term, "a user folder");
  assert.equal(paths[0].found, "C:\\Users\\morgan.ellery\\Documents\\week1.txt");
});

test("the patterns find paths, addresses and phone numbers, but leave example ones alone", () => {
  assert.ok(terms("D:\\Projects\\Grant\\budget.xlsx").includes("a full file path"));
  assert.ok(terms("\\\\fileserver\\staff\\notes").includes("a network share"));
  assert.ok(terms("Write to dana.reyes@quillfield.edu").includes("an email address"));
  assert.deepEqual(terms("Write to dana@example.com"), []);
  assert.ok(terms("Call 312-867-4421").includes("a phone number"));
  assert.deepEqual(terms("Call 312-555-0142"), []);
  assert.deepEqual(terms("Lessons/Week 1 and File > Save"), []);
});

test("hits say where they are in the text", () => {
  const [h] = findHits("Try Zentrova now", list);
  assert.equal("Try Zentrova now".slice(h.start, h.end), "Zentrova");
});

test("look-alike letters are merged", () => {
  assert.equal(normal("Cornrnon 0ffice"), normal("Common Office"));
});

test("terms too short to block safely are refused", () => {
  const { problems } = makeBlocklist([{ terms: ["ab"] }]);
  assert.equal(problems.length, 1);
});

test("the starter file lists every category, empty", () => {
  const f = JSON.parse(starterBlocklistFile());
  assert.deepEqual(Object.keys(f.byCategory), ["product", "person", "institution", "path", "other"]);
  assert.ok(Object.values(f.byCategory).every((v) => Array.isArray(v) && v.length === 0));
});

test("the script scan checks narration, typed values and labels, but not control names", () => {
  const script = {
    format: "openstage-studio-script", version: 1, title: "A lesson", goal: "Plan", program: { id: "practice-planner", name: "Practice Planner" },
    startState: { demoProject: "starter" },
    steps: [
      { action: "type", target: "zentrova.field", value: "Imported from Zentrova", narration: "Type the name." },
      { action: "click", target: "toolbar.save", narration: "Save it to C:\\Users\\morgan.ellery.", callout: { type: "label", text: "Quillmark Studio", near: "toolbar.save" } },
    ],
  };
  const hits = scanScript(script, list);
  assert.deepEqual(hits.map((h) => h.path), ["steps[0].value", "steps[1].narration", "steps[1].narration", "steps[1].callout.text"]);
});

test("a short name must match exactly, so ordinary words that are one letter off are not flagged", () => {
  const { list: short } = makeBlocklist([], { userName: "Jason" });
  assert.deepEqual(findHits("Saved as notes.json for Mason", short), []);
  assert.equal(findHits("Signed in as JASON", short).length, 1);
});

test("notes for people are not scanned, only what a viewer sees or hears", () => {
  const { list: short } = makeBlocklist([], { userName: "Jason" });
  const hits = scanScript({ title: "A lesson", startState: { demoProject: "x", note: "Jason wrote this" }, writtenBy: { kind: "person", name: "Jason" }, steps: [{ action: "click", expect: "Jason sees it", narration: "Select it." }] }, short);
  assert.deepEqual(hits, []);
});
