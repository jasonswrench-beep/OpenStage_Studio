// A manual, as Studio reads it: chapters of topics, each with its words and its numbered steps. It comes from a
// documentation project file (the preferred import: each step and click is already there) or from a PDF (words only; the
// AI has to work out the steps from the prose). Reading a manual never changes it.

export interface ManualStep {
  /** What to do, with control names marked as [[Name]]. */
  text: string;
  /** What happens, if the manual says. */
  result?: string;
  /** The control the author clicked when the step was captured, if the project recorded it. */
  clicked?: { name?: string; role?: string };
}

export interface Topic {
  id: string;
  title: string;
  /** How deep it sits under the chapter: 0 is the chapter's own page, 1 a topic, 2 a topic of a topic. */
  depth: number;
  /** The page's words: paragraphs, headings and boxes, as plain text with [[Control]] marks. */
  text: string;
  procedures: ManualStep[][];
}

export interface Chapter {
  id: string;
  title: string;
  topics: Topic[];
}

export interface Manual {
  title: string;
  /** Where it came from: a documentation project file or a PDF. */
  kind: "project" | "pdf";
  file: string;
  /** The program the manual is about, if it says ({{PRODUCT}} in a project). */
  product?: string;
  chapters: Chapter[];
}

/** One chapter as plain text for the AI: titles, words and numbered steps, with what was clicked. */
export function chapterText(c: Chapter): string {
  const out: string[] = [`# ${c.title}`];
  for (const t of c.topics) {
    if (t.depth > 0) out.push("", `${"#".repeat(Math.min(4, t.depth + 1))} ${t.title}`);
    if (t.text.trim()) out.push(t.text.trim());
    for (const p of t.procedures) {
      out.push("");
      p.forEach((s, i) => {
        out.push(`${i + 1}. ${s.text}${s.clicked?.name ? ` (clicked: ${s.clicked.role ? `${s.clicked.role} ` : ""}"${s.clicked.name}")` : ""}`);
        if (s.result) out.push(`   Result: ${s.result}`);
      });
    }
  }
  return out.join("\n") + "\n";
}

/** Find a chapter by its number (1 is the first) or by words in its title. */
export function findChapter(m: Manual, which: string | undefined): Chapter {
  if (!m.chapters.length) throw new Error(`${m.title} has no chapters.`);
  if (!which) return m.chapters[0];
  const n = Number(which);
  if (Number.isInteger(n) && n >= 1 && n <= m.chapters.length) return m.chapters[n - 1];
  const want = which.toLowerCase();
  const found = m.chapters.find((c) => c.title.toLowerCase() === want) ?? m.chapters.find((c) => c.title.toLowerCase().includes(want));
  if (!found) throw new Error(`${m.title} has no chapter called "${which}". Its chapters are: ${m.chapters.map((c, i) => `${i + 1}. ${c.title}`).join("; ")}.`);
  return found;
}
