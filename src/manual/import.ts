// Importing a manual: a documentation project file (.openexplainer, a zip of JSON files and pictures) or a PDF.
// Only reading. Pictures are not read; each step keeps what the author clicked, from the project's click notes.

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { readZip } from "../util/zip.ts";
import type { Chapter, Manual, ManualStep, Topic } from "./manual.ts";

type Run = { text: string; mark?: string };
type Json = Record<string, unknown>;

/** Text with marks as plain words, control names marked [[Name]], variables filled in. */
function runs(value: unknown, vars: Record<string, string>): string {
  const list: Run[] = Array.isArray(value) ? (value as Run[]) : typeof value === "string" ? [{ text: value }] : [];
  return list
    .map((r) => (r.mark === "control" ? `[[${r.text}]]` : String(r.text ?? "")))
    .join("")
    .replace(/\{\{([A-Z0-9_]+)\}\}/g, (all, name: string) => vars[name] ?? all);
}

const CALLOUT_WORDS: Record<string, string> = {
  "design-tip": "Design tip", caution: "Caution", "bright-idea": "Bright idea", "power-tip": "Power tip", "time-saver": "Time saver", "new-feature": "New in this version",
};

/** The most one manual may unpack to, in bytes: far more than any manual's words. */
const MOST_MANUAL = 512 * 1024 * 1024;

export function readProjectManual(file: string): Manual {
  const entries = readZip(readFileSync(file), MOST_MANUAL);
  const get = (name: string): Json | null => {
    const e = entries.find((x) => x.name === name);
    return e ? (JSON.parse(e.read().toString("utf8")) as Json) : null;
  };
  const project = get("project.json");
  const structure = get("structure.json");
  if (!project || !structure) throw new Error(`${basename(file)} is not a documentation project (it has no project.json or structure.json).`);
  const vars = (project.variables ?? {}) as Record<string, string>;
  type Node = { id: string; title: string; pictures?: { id: string; click?: { target?: { name?: string; role?: string } } }[]; children?: Node[] };
  const topicOf = (n: Node, depth: number): Topic => {
    const page = /^[A-Za-z0-9_-]{1,64}$/.test(n.id) ? get(`topics/${n.id}.json`) : null;
    const clicks = new Map((n.pictures ?? []).filter((p) => p.click?.target).map((p) => [p.id, p.click!.target!]));
    const text: string[] = [];
    const procedures: ManualStep[][] = [];
    for (const b of ((page?.blocks ?? []) as Json[])) {
      if (b.type === "paragraph") text.push(runs(b.text, vars));
      else if (b.type === "heading") text.push(`${String(b.text ?? "")}:`);
      else if (b.type === "callout") text.push(`${CALLOUT_WORDS[String(b.kind)] ?? "Note"}: ${runs(b.text, vars)}`);
      else if (b.type === "procedure") {
        procedures.push(((b.steps ?? []) as Json[]).map((s) => {
          const target = typeof s.pictureId === "string" ? clicks.get(s.pictureId) : undefined;
          const result = runs(s.result, vars);
          return {
            text: runs(s.text, vars),
            ...(result ? { result } : {}),
            ...(target && (target.name || target.role) ? { clicked: { ...(target.name ? { name: target.name } : {}), ...(target.role ? { role: target.role } : {}) } } : {}),
          };
        }));
      }
    }
    return { id: n.id, title: runs(n.title, vars), depth, text: text.join("\n\n"), procedures };
  };
  const walk = (n: Node, depth: number, into: Topic[]) => {
    into.push(topicOf(n, depth));
    for (const c of n.children ?? []) walk(c, depth + 1, into);
  };
  const chapters: Chapter[] = ((structure.tree ?? []) as Node[]).map((c) => {
    const topics: Topic[] = [];
    walk(c, 0, topics);
    return { id: c.id, title: runs(c.title, vars), topics };
  });
  return { title: String(project.name ?? basename(file)), kind: "project", file, ...(vars.PRODUCT ? { product: vars.PRODUCT } : {}), chapters };
}

/** A PDF's words, chapter by chapter: by its bookmarks where it has them, otherwise the whole document as one chapter. */
export async function readPdfManual(file: string): Promise<Manual> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: false });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    let line = "";
    const lines: string[] = [];
    let lastY: number | null = null;
    for (const item of content.items as { str?: string; transform?: number[]; hasEOL?: boolean }[]) {
      if (typeof item.str !== "string") continue;
      const y = item.transform?.[5] ?? 0;
      if (lastY !== null && Math.abs(y - lastY) > 2 && line) {
        lines.push(line.trim());
        line = "";
      }
      line += item.str;
      if (item.hasEOL) {
        lines.push(line.trim());
        line = "";
      }
      lastY = y;
    }
    if (line.trim()) lines.push(line.trim());
    pages.push(lines.filter(Boolean).join("\n"));
  }
  // Chapters from the top level of the bookmarks, each running to the next one's page.
  const outline = (await doc.getOutline()) ?? [];
  const starts: { title: string; page: number }[] = [];
  for (const o of outline) {
    try {
      const dest = typeof o.dest === "string" ? await doc.getDestination(o.dest) : o.dest;
      if (!dest) continue;
      const page = (await doc.getPageIndex(dest[0] as never)) + 1;
      starts.push({ title: o.title, page });
    } catch {
      // A bookmark that points nowhere is skipped.
    }
  }
  starts.sort((a, b) => a.page - b.page);
  const title = basename(file, extname(file));
  const chapters: Chapter[] = starts.length
    ? starts.map((s, i) => {
      const end = i + 1 < starts.length ? Math.max(s.page, starts[i + 1].page - 1) : doc.numPages;
      const text = pages.slice(s.page - 1, end).join("\n\n");
      return { id: `pdf-${i + 1}`, title: s.title, topics: [{ id: `pdf-${i + 1}-text`, title: s.title, depth: 0, text, procedures: [] }] };
    })
    : [{ id: "pdf-1", title, topics: [{ id: "pdf-1-text", title, depth: 0, text: pages.join("\n\n"), procedures: [] }] }];
  await task.destroy();
  return { title, kind: "pdf", file, chapters };
}

export async function importManual(file: string): Promise<Manual> {
  const ext = extname(file).toLowerCase();
  if (ext === ".openexplainer") return readProjectManual(file);
  if (ext === ".pdf") return readPdfManual(file);
  throw new Error(`Studio reads a documentation project (.openexplainer) or a PDF. ${basename(file)} is neither.`);
}
