// The blocklist: words and patterns that must never appear in a video, and the allowlist of names that are always fine.
//
// The repository ships the categories and the patterns (file paths, email addresses, phone numbers, this computer's user
// name and home folder). Names of other companies' products are never written into the repository; each person keeps
// them in their own blocklist file on their computer (`blocklist.local.json`, which git ignores). `Edit Blocklist.bat`
// starts one.
//
// Matching tolerates text that was misread or cut off, because the frame scan reads text from pictures.

export const CATEGORIES = {
  product: "Another company's product or brand",
  person: "A real person's name or personal details",
  institution: "A real institution or organisation",
  path: "A file path or folder name",
  other: "Something you blocked",
} as const;
export type Category = keyof typeof CATEGORIES;

export interface Term {
  text: string;
  category: Category;
  /** Why it is blocked, for the person reviewing. */
  note?: string;
}

export interface Blocklist {
  terms: Term[];
  /** Names that are never flagged, such as your own products. A hit inside one of these is not a hit. */
  allow: string[];
  /** Whether the built-in patterns run (paths, email addresses, phone numbers). On unless a list turns them off. */
  patterns: boolean;
}

/** The person's own blocklist file, as written by hand. */
export interface BlocklistFile {
  format?: "openstage-studio-blocklist";
  version?: 1;
  /** A note for the person editing the file; not read. */
  about?: string;
  terms?: (string | Term)[];
  /** Terms by category, a shorter way to write them: `{ "product": ["..."] }`. */
  byCategory?: Partial<Record<Category, string[]>>;
  allow?: string[];
  patterns?: boolean;
}

/** Your own names, never flagged. Part of the repository because they are ours. */
export const BUILT_IN_ALLOW = ["OpenStage", "OpenStage Studio", "OpenStage Author", "OpenScreen", "Practice Planner"];

/** About this computer, so its user name and home folder are blocked without anyone writing them down. */
export interface ComputerFacts {
  userName?: string;
  homeFolder?: string;
  computerName?: string;
}

/** Builds the blocklist from the person's files and this computer's facts. Later files add to earlier ones. */
export function makeBlocklist(files: BlocklistFile[], computer: ComputerFacts = {}): { list: Blocklist; problems: string[] } {
  const problems: string[] = [];
  const terms: Term[] = [];
  const allow = [...BUILT_IN_ALLOW];
  let patterns = true;
  const add = (t: Term, where: string) => {
    if (typeof t.text !== "string" || t.text.trim() === "") return problems.push(`${where}: a blocked term needs its words.`);
    if (!(t.category in CATEGORIES)) return problems.push(`${where}: "${t.category}" is not a category. Use one of ${Object.keys(CATEGORIES).join(", ")}.`);
    if (normal(t.text).replace(/ /g, "").length < 3) return problems.push(`${where}: "${t.text}" is too short to block safely (it would match everywhere).`);
    terms.push({ text: t.text.trim(), category: t.category, ...(t.note ? { note: t.note } : {}) });
  };
  files.forEach((f, n) => {
    const where = `blocklist ${n + 1}`;
    (f.terms ?? []).forEach((t, i) => add(typeof t === "string" ? { text: t, category: "other" } : t, `${where}, term ${i + 1}`));
    for (const [cat, list] of Object.entries(f.byCategory ?? {})) (list ?? []).forEach((text, i) => add({ text, category: cat as Category }, `${where}, ${cat} ${i + 1}`));
    for (const a of f.allow ?? []) if (typeof a === "string" && a.trim()) allow.push(a.trim());
    if (f.patterns === false) patterns = false;
  });
  // This computer: its user name, its name, and the last part of the home folder (often the same as the user name).
  const seen = new Set(terms.map((t) => normal(t.text)));
  const fact = (text: string | undefined, note: string) => {
    if (!text || normal(text).replace(/ /g, "").length < 3 || seen.has(normal(text))) return;
    seen.add(normal(text));
    terms.push({ text, category: "person", note });
  };
  fact(computer.userName, "This computer's user name");
  fact(computer.homeFolder?.split(/[\\/]/).filter(Boolean).pop(), "The name of this computer's home folder");
  fact(computer.computerName, "This computer's name");
  return { list: { terms, allow, patterns }, problems };
}

// ---------------------------------------------------------------------------------------------------------------------
// Normalising text, so a misread letter or a stray space does not hide a name.

/** Letters that text recognition commonly confuses, mapped to one form. Applied to both sides of a comparison. */
const LOOK_ALIKE: [RegExp, string][] = [
  [/rn/g, "m"], [/vv/g, "w"], [/[0]/g, "o"], [/[1|!il]/g, "l"], [/[5$]/g, "s"],
];

/** Lower case, accents removed, look-alike letters merged, anything that is not a letter or digit turned into one space. */
export function normal(text: string): string {
  let t = text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  t = t.replace(/[^a-z0-9|!$]+/g, " ");
  for (const [from, to] of LOOK_ALIKE) t = t.replace(from, to);
  return t.replace(/ +/g, " ").trim();
}

/** The text with no spaces, and for each character of it, where it came from in the original. */
function compact(text: string): { s: string; at: number[] } {
  const chars: string[] = [];
  const at: number[] = [];
  // Normalise character by character so positions can be mapped back. Pairs such as "rn" are handled after.
  for (let i = 0; i < text.length; i++) {
    const n = normal(text[i]);
    for (const c of n.replace(/ /g, "")) {
      chars.push(c);
      at.push(i);
    }
  }
  // Merge the two-letter look-alikes, keeping the first letter's position.
  const s: string[] = [];
  const pos: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const two = chars[i] + (chars[i + 1] ?? "");
    if (two === "rn" || two === "vv") {
      s.push(two === "rn" ? "m" : "w");
      pos.push(at[i]);
      i++;
    } else {
      s.push(chars[i]);
      pos.push(at[i]);
    }
  }
  return { s: s.join(""), at: pos };
}

/** How many letters may differ for a term of this length (after normalising). Short terms must match exactly. */
export function tolerance(length: number): number {
  // Up to five letters must match exactly: one letter's difference would let a short name match ordinary words.
  if (length <= 5) return 0;
  if (length <= 9) return 1;
  return 2;
}

/** The edit distance between a and b, or limit + 1 once it is certain to be more than limit. */
function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

// ---------------------------------------------------------------------------------------------------------------------
// Finding hits.

export interface Hit {
  /** The blocked term, or the pattern's name. */
  term: string;
  category: Category;
  note?: string;
  /** The words as they appear in the text that was searched. */
  found: string;
  /** Where in that text, as character positions. */
  start: number;
  end: number;
  /** How the match was made: exactly, with a few letters different, or with the end of the text cut off. */
  how: "exact" | "close" | "partial" | "pattern";
}

/** Email domains kept for examples and tests, which invented demo content should use. */
const EXAMPLE_DOMAIN = /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$/i;

interface Pattern {
  name: string;
  category: Category;
  note: string;
  re: RegExp;
  keep?: (m: RegExpExecArray) => boolean;
}

/** The built-in patterns. Each finds a kind of thing rather than a particular one. */
export const PATTERNS: Pattern[] = [
  {
    name: "a user folder", category: "path", note: "A path into someone's own folder shows their user name.",
    re: /(?:[A-Za-z]:\s?[\\/]\s?(?:Users|Documents and Settings)|\/(?:Users|home))\s?[\\/]\s?[^\\/\s"'<>|]+/gi,
  },
  {
    name: "a full file path", category: "path", note: "A full path shows how a computer's folders are named.",
    re: /\b[A-Za-z]:\s?[\\/](?:[^\\/\s"'<>|]+[\\/]?)+/g,
  },
  {
    name: "a network share", category: "path", note: "A network path names a real server.",
    re: /\\\\[A-Za-z0-9._-]+\\[^\s"'<>|]+/g,
  },
  {
    name: "an environment folder", category: "path", note: "A folder named from the computer's settings.",
    re: /%(?:USERPROFILE|USERNAME|APPDATA|LOCALAPPDATA|HOMEPATH|ONEDRIVE)%/gi,
  },
  {
    name: "an email address", category: "person", note: "Use an address at an example domain (such as name@example.com) in demo content.",
    re: /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g,
    keep: (m) => !EXAMPLE_DOMAIN.test(m[1]),
  },
  {
    name: "a phone number", category: "person", note: "Invented phone numbers should use 555-0100 to 555-0199.",
    re: /(?:\+?1[-. ]?)?\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g,
    keep: (m) => !/555[-. ]01\d\d\b/.test(m[0]),
  },
];

/** Every hit in one piece of text. */
export function findHits(text: string, list: Blocklist): Hit[] {
  const hits: Hit[] = [];
  if (!text.trim()) return hits;
  const c = compact(text);
  const allowed = allowedSpans(c, list.allow);
  const inAllowed = (from: number, to: number) => allowed.some(([a, b]) => from >= a && to <= b);

  for (const term of list.terms) {
    const t = compact(term.text).s;
    if (t.length < 3) continue;
    const k = tolerance(t.length);
    const found = k === 0 ? exactWords(text, term.text) : closeMatches(c.s, t, k);
    for (const [from, to, how] of found) {
      if (k > 0 && inAllowed(from, to)) continue;
      const start = k === 0 ? from : c.at[from];
      const end = k === 0 ? to : c.at[to - 1] + 1;
      if (k === 0 && allowedSpansRaw(text, list.allow).some(([a, b]) => start >= a && end <= b)) continue;
      hits.push({ term: term.text, category: term.category, ...(term.note ? { note: term.note } : {}), found: text.slice(start, end), start, end, how });
    }
  }
  if (list.patterns) {
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      for (let m = p.re.exec(text); m; m = p.re.exec(text)) {
        if (p.keep && !p.keep(m)) continue;
        const start = m.index, end = m.index + m[0].length;
        // Paths found by more than one pattern (a user folder is also a full path) are one hit: the more telling name
        // (patterns are listed most telling first) over the whole of the path.
        const same = hits.find((h) => h.how === "pattern" && h.category === p.category && h.start < end && h.end > start);
        if (same) {
          same.start = Math.min(same.start, start);
          same.end = Math.max(same.end, end);
          same.found = text.slice(same.start, same.end);
          continue;
        }
        hits.push({ term: p.name, category: p.category, note: p.note, found: m[0], start, end, how: "pattern" });
      }
    }
  }
  return dedupe(hits);
}

/** Exact whole-word matches of a short term (after normalising), as positions in the original text. */
function exactWords(text: string, term: string): [number, number, Hit["how"]][] {
  const want = normal(term);
  const out: [number, number, Hit["how"]][] = [];
  // Words of the original text with their positions.
  const words: { s: string; from: number; to: number }[] = [];
  const re = /[\p{L}\p{N}|!$]+/gu;
  for (let m = re.exec(text); m; m = re.exec(text)) words.push({ s: normal(m[0]), from: m.index, to: m.index + m[0].length });
  const n = want.split(" ").length;
  for (let i = 0; i + n <= words.length; i++) {
    if (words.slice(i, i + n).map((w) => w.s).join(" ") === want) out.push([words[i].from, words[i + n - 1].to, "exact"]);
  }
  return out;
}

/** Places in the compacted text that match the term within k letters, or that are its first or last three quarters
 * where the text is cut off. Overlapping matches are reduced to the best one. */
function closeMatches(s: string, t: string, k: number): [number, number, Hit["how"]][] {
  const found: [number, number, Hit["how"], number][] = [];
  const L = t.length;
  for (let i = 0; i < s.length; i++) {
    // A cheap first test: one of the term's first three letters must be here.
    if (!t.slice(0, k + 1).includes(s[i])) continue;
    let best: [number, number] | null = null;
    for (let len = Math.max(1, L - k); len <= L + k && i + len <= s.length; len++) {
      const d = distance(s.slice(i, i + len), t, k);
      if (d <= k && (!best || d < best[1])) best = [len, d];
    }
    if (best) found.push([i, i + best[0], best[1] === 0 ? "exact" : "close", best[1]]);
  }
  // Cut off: the text ends partway through the term, or begins partway through it (only for long terms).
  if (L >= 8) {
    const part = Math.ceil(L * 0.75);
    const head = t.slice(0, part);
    const tail = t.slice(L - part);
    if (s.length >= part && distance(s.slice(s.length - part), head, 1) <= 1) found.push([s.length - part, s.length, "partial", 1]);
    if (s.length >= part && distance(s.slice(0, part), tail, 1) <= 1) found.push([0, part, "partial", 1]);
  }
  found.sort((a, b) => a[3] - b[3] || a[0] - b[0]);
  const kept: [number, number, Hit["how"]][] = [];
  for (const [a, b, how] of found) if (!kept.some(([x, y]) => a < y && b > x)) kept.push([a, b, how]);
  return kept.sort((p, q) => p[0] - q[0]);
}

/** Where allowlisted names appear in the compacted text. */
function allowedSpans(c: { s: string }, allow: string[]): [number, number][] {
  const spans: [number, number][] = [];
  for (const a of allow) {
    const t = compact(a).s;
    if (!t) continue;
    for (let i = c.s.indexOf(t); i >= 0; i = c.s.indexOf(t, i + 1)) spans.push([i, i + t.length]);
  }
  return spans;
}

/** Where allowlisted names appear in the original text, by whole words. */
function allowedSpansRaw(text: string, allow: string[]): [number, number][] {
  return allow.flatMap((a) => exactWords(text, a).map(([x, y]) => [x, y] as [number, number]));
}

function dedupe(hits: Hit[]): Hit[] {
  const out: Hit[] = [];
  for (const h of hits) if (!out.some((o) => o.term === h.term && o.start === h.start && o.end === h.end)) out.push(h);
  return out.sort((a, b) => a.start - b.start || a.term.localeCompare(b.term));
}

/** A starter file for a person's own blocklist, with every category empty and a note on each. */
export function starterBlocklistFile(): string {
  return JSON.stringify({
    format: "openstage-studio-blocklist",
    version: 1,
    "about": "Words that must never appear in a video. This file stays on this computer (git ignores it). Add names under each category; matching ignores case and tolerates misread letters. Put your own product names in allow so they are never flagged.",
    byCategory: { product: [], person: [], institution: [], path: [], other: [] },
    allow: [],
  }, null, 2) + "\n";
}
