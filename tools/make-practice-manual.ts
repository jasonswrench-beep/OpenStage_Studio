// Writes examples/manuals/Practice Planner Guide.openexplainer: an invented manual for the invented practice program,
// in the documentation tool's project format (version 16), for phase 3's acceptance test. Every name and word in it is
// made up. Run it again after changing the text: node tools/make-practice-manual.ts

import { crc32, deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = 16;

type Run = { text: string; mark?: "bold" | "italic" | "control" };
let counter = 0;
const id = (prefix: string) => `${prefix}${(++counter).toString(36).padStart(4, "0")}pp`;

/** Text with [[Control]] and *italic* marks, as the documentation tool's runs. */
function marked(text: string): Run[] {
  const out: Run[] = [];
  const re = /\[\[([^\]]+)\]\]|\*([^*]+)\*/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push(m[1] ? { text: m[1], mark: "control" } : { text: m[2], mark: "italic" });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** A tiny grey PNG standing in for a captured picture (the guide's pictures are not needed for planning). */
function placeholderPng(): Buffer {
  const w = 8, h = 8;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0xd0);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

interface StepIn { text: string; result?: string; clicked?: [string, string] }
interface TopicIn { title: string; intro: string; steps?: StepIn[]; tip?: string; children?: TopicIn[] }

const GUIDE: { title: string; intro: string; topics: TopicIn[] }[] = [
  {
    title: "About this guide",
    intro: "This guide shows how to plan lessons with {{PRODUCT}}. Each chapter is a set of short tasks you can try in order.",
    topics: [
      { title: "What Practice Planner is for", intro: "{{PRODUCT}} keeps a term's lessons in one place: a list of lessons on the left, and the lesson you are working on on the right. Each lesson has a title, a subject, a length, notes, and a checklist of things to bring." },
    ],
  },
  {
    title: "Planning lessons",
    intro: "This chapter covers the everyday work of planning: making a lesson, writing its notes, listing what to bring, finding a lesson again, copying one for another class, and sharing it with the class page.",
    topics: [
      {
        title: "Making a new lesson",
        intro: "Start a lesson from a blank page, give it a title, and choose its subject and length.",
        steps: [
          { text: "On the toolbar, click [[New lesson]].", result: "A blank lesson opens on the right, and *Untitled lesson* appears at the end of the list.", clicked: ["New lesson", "button"] },
          { text: "In [[Lesson title]], type a title such as *Sorting leaves by shape*.", result: "The title shows in the list as you type." },
          { text: "In the [[Subject]] list, choose *Science*." },
          { text: "In the [[Length]] list, choose *30 minutes*." },
          { text: "Click [[Save lesson]].", result: "The status line says the lesson was saved.", clicked: ["Save lesson", "button"] },
        ],
        tip: "Press Ctrl+S to save at any time.",
      },
      {
        title: "Writing the lesson notes",
        intro: "The notes hold the plan itself. The Insert menu adds ready-made lines, such as a learning objective, so every plan starts the same way.",
        steps: [
          { text: "In the list, click the lesson *How seeds become plants*.", result: "The lesson opens on the right." },
          { text: "Click in the [[Notes]] box." },
          { text: "On the toolbar, click [[Insert]], then click [[Learning objective]].", result: "A new line starting *Objective:* is added at the end of the notes.", clicked: ["Learning objective", "menuitem"] },
          { text: "Type the objective, such as *name the parts of a seed*." },
          { text: "Click [[Save lesson]]." },
        ],
      },
      {
        title: "Listing things to bring",
        intro: "The checklist under Things to bring reminds you what the class needs. Each item has its own box.",
        steps: [
          { text: "In the list, click the lesson *Weather diary*." },
          { text: "Under Things to bring, click [[Add item]].", result: "An empty box appears under the last item.", clicked: ["Add item", "button"] },
          { text: "Type the item, such as *Coloured pencils*." },
          { text: "Click [[Save lesson]]." },
        ],
      },
      {
        title: "Finding a lesson",
        intro: "When the list is long, search finds a lesson by words in its title.",
        steps: [
          { text: "Click in [[Search lessons]] above the list." },
          { text: "Type part of the title, such as *water*.", result: "The list shows only the lessons whose titles have those words: here, *The water cycle*." },
          { text: "Click the lesson to open it." },
        ],
        tip: "Clear the search box to see every lesson again.",
      },
      {
        title: "Copying a lesson for another class",
        intro: "To teach the same lesson to another class, copy it and change the copy, so the first one stays as it was.",
        steps: [
          { text: "In the list, click the lesson to copy, such as *Map reading basics*." },
          { text: "On the toolbar, click [[Duplicate]].", result: "A copy opens, with *(copy)* after its title, just under the lesson it copies.", clicked: ["Duplicate", "button"] },
          { text: "In [[Lesson title]], change the title, for example to *Map reading for class 2*." },
          { text: "Click [[Save lesson]]." },
        ],
      },
      {
        title: "Sharing a lesson with the class page",
        intro: "A shared lesson appears on the class page, so learners can see what is coming.",
        steps: [
          { text: "In the list, click the lesson to share, such as *Story openings*." },
          { text: "On the toolbar, click [[Lesson settings]].", result: "The Lesson settings dialog opens.", clicked: ["Lesson settings", "button"] },
          { text: "Select [[Share this lesson with the class page]]." },
          { text: "If you want a reminder, also select [[Remind me the day before]]." },
          { text: "Click [[OK]].", result: "The status line says the lesson will be shared with the class page.", clicked: ["OK", "button"] },
        ],
      },
    ],
  },
];

const files: { name: string; data: Buffer }[] = [];
const pages: Record<string, unknown> = {};
const png = placeholderPng();

function topicNode(t: TopicIn): unknown {
  const nodeId = id("t");
  const pictures: unknown[] = [];
  const blocks: unknown[] = [{ id: id("b"), type: "paragraph", text: marked(t.intro) }];
  if (t.steps) {
    blocks.push({
      id: id("b"), type: "procedure",
      steps: t.steps.map((s) => {
        let pictureId: string | undefined;
        if (s.clicked) {
          pictureId = id("p");
          pictures.push({
            id: pictureId, file: `images/${pictureId}.png`, width: 8, height: 8,
            altText: `Practice Planner, with the pointer on ${s.clicked[0]}.`,
            source: { kind: "click", capturedAt: "2026-11-15T09:00:00.000Z", originalName: `Click on the ${s.clicked[1]} "${s.clicked[0]}"` },
            click: { x: 4, y: 4, button: "left", target: { name: s.clicked[0], role: s.clicked[1] } },
          });
          files.push({ name: `images/${pictureId}.png`, data: png });
        }
        return { id: id("s"), text: marked(s.text), ...(pictureId ? { pictureId } : {}), ...(s.result ? { result: marked(s.result) } : {}) };
      }),
    });
  }
  if (t.tip) blocks.push({ id: id("b"), type: "callout", kind: "time-saver", text: marked(t.tip) });
  pages[nodeId] = { version: VERSION, blocks };
  return { id: nodeId, title: t.title, status: "drafted", pictures, children: (t.children ?? []).map(topicNode) };
}

const tree = GUIDE.map((c) => {
  const chapterId = id("c");
  pages[chapterId] = { version: VERSION, blocks: [{ id: id("b"), type: "paragraph", text: marked(c.intro) }] };
  return { id: chapterId, title: c.title, status: "drafted", pictures: [], children: c.topics.map(topicNode) };
});

const json = (o: unknown) => Buffer.from(JSON.stringify(o, null, 2) + "\n");
files.unshift(
  { name: "project.json", data: json({ version: VERSION, name: "Practice Planner Guide", template: "manual", language: "en", variables: { PRODUCT: "Practice Planner", VERSION: "1.0", COMPANY: "An invented school" } }) },
  { name: "structure.json", data: json({ version: VERSION, tree }) },
  ...Object.entries(pages).map(([k, v]) => ({ name: `topics/${k}.json`, data: json(v) })),
);

/** A zip with every file stored (no compression), as the documentation tool writes it. */
function zip(entries: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(e.data.length, 18);
    head.writeUInt32LE(e.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, e.data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(e.data.length, 20);
    dir.writeUInt32LE(e.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + e.data.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dirBytes, end]);
}

const out = join(ROOT, "examples", "manuals", "Practice Planner Guide.openexplainer");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, zip(files));
console.log(`Wrote ${out} (${files.length} files).`);
