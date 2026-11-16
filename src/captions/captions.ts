// Captions, the transcript and the chapter list, made from the script and the timeline rather than from speech
// recognition, so they are right on the first pass, product names included.

import type { Script, Step } from "../script/format.ts";
import { parseKey } from "../script/format.ts";
import type { Cue, Timeline } from "../timeline/build.ts";

/** At most this many characters on a caption line, and two lines a caption: the usual limits for readable captions. */
export const LINE_MAX = 42;
export const LINES_MAX = 2;

/** Split text into pieces that each fit on one caption (two lines), at sentence ends, then commas, then spaces. */
export function captionPieces(text: string, max = LINE_MAX * LINES_MAX): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const pieces: string[] = [];
  for (const s of sentences) {
    if (s.length <= max) pieces.push(s);
    else {
      const clauses = s.split(/(?<=[,;:])\s+/);
      let current = "";
      for (const c of clauses) {
        for (const word of c.length <= max ? [c] : c.split(" ")) {
          const joined = current ? `${current} ${word}` : word;
          if (joined.length <= max) current = joined;
          else {
            if (current) pieces.push(current);
            current = word;
          }
        }
        if (c.length <= max && current.length > max * 0.6) {
          pieces.push(current);
          current = "";
        }
      }
      if (current) pieces.push(current);
    }
  }
  // Join short neighbours back together where they fit.
  const joined: string[] = [];
  for (const p of pieces) {
    const last = joined[joined.length - 1];
    if (last !== undefined && `${last} ${p}`.length <= max && last.length < 30) joined[joined.length - 1] = `${last} ${p}`;
    else joined.push(p);
  }
  return joined;
}

/** Break one caption's text into at most two lines, as even as possible. */
export function captionLines(text: string): string[] {
  if (text.length <= LINE_MAX) return [text];
  const words = text.split(" ");
  let best: string[] = [text];
  let bestScore = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" ");
    const b = words.slice(k).join(" ");
    if (a.length > LINE_MAX || b.length > LINE_MAX) continue;
    const score = Math.abs(a.length - b.length);
    if (score < bestScore) [best, bestScore] = [[a, b], score];
  }
  return best;
}

export interface Caption {
  startMs: number;
  endMs: number;
  lines: string[];
}

/** Captions for the narration cues: long narration is split into pieces, timed in proportion to their length. */
export function makeCaptions(cues: Cue[]): Caption[] {
  const out: Caption[] = [];
  for (const cue of cues) {
    const pieces = captionPieces(cue.text);
    const total = pieces.reduce((n, p) => n + p.length, 0) || 1;
    let at = cue.startMs;
    pieces.forEach((p, k) => {
      const end = k === pieces.length - 1 ? cue.endMs : at + Math.round(((cue.endMs - cue.startMs) * p.length) / total);
      // Every caption stays up long enough to read (at least a second), unless the next one starts.
      out.push({ startMs: at, endMs: Math.max(end, at + 1000), lines: captionLines(p) });
      at = end;
    });
  }
  for (let k = 0; k + 1 < out.length; k++) out[k].endMs = Math.min(out[k].endMs, out[k + 1].startMs);
  return out;
}

function stamp(ms: number, sep: string): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const r = ms % 1000;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(h)}:${two(m)}:${two(s)}${sep}${String(r).padStart(3, "0")}`;
}

export function toSrt(captions: Caption[]): string {
  return captions.map((c, k) => `${k + 1}\r\n${stamp(c.startMs, ",")} --> ${stamp(c.endMs, ",")}\r\n${c.lines.join("\r\n")}\r\n`).join("\r\n");
}

export function toVtt(captions: Caption[]): string {
  return "WEBVTT\n\n" + captions.map((c) => `${stamp(c.startMs, ".")} --> ${stamp(c.endMs, ".")}\n${c.lines.join("\n")}\n`).join("\n");
}

/** A short, plain description of what a step does on screen, for the transcript. */
export function describeAction(step: Step, label?: string, role?: string): string {
  const name = label ? `"${label}"` : step.target ? `the control ${step.target}` : "";
  switch (step.action) {
    case "click": return `Click ${name}.`;
    case "type":
      if (role === "combobox") return `In ${name}, choose "${step.value ?? ""}".`;
      return `${name ? `In ${name}, type` : "Type"} "${step.value ?? ""}".`;
    case "key": {
      const key = parseKey(step.value ?? "");
      return `Press ${key ? [...key.modifiers, key.key].join("+") : step.value}.`;
    }
    case "scroll": return `Scroll ${(step.value ?? "down 300").split(" ")[0]}${name ? ` in ${name}` : ""}.`;
    case "open": return `Open the demo project ${step.value}.`;
    case "wait": return "Wait a moment.";
    case "drag": return `Drag ${name}.`;
  }
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m % 60)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** The plain transcript: the title, the goal, and every step with what happens on screen and what is said. */
export function makeTranscript(script: Script, timeline: Timeline, targets: ({ label?: string; role?: string } | undefined)[]): string {
  const out: string[] = [`${script.title}`, "", `${script.program.name}. ${script.goal}`, ""];
  if (script.intro) out.push(script.intro, "");
  timeline.steps.forEach((t, k) => {
    const step = script.steps[t.index];
    if (step.chapter) out.push(`${step.chapter}`, "");
    out.push(`Step ${k + 1} (${clock(t.startMs)}). On screen: ${describeAction(step, targets[t.index]?.label, targets[t.index]?.role)}`);
    if (step.narration && !step.silent) out.push(`Narration: ${step.narration}`);
    if (step.describe) out.push(`Description: ${step.describe}`);
    out.push("");
  });
  if (script.outro) out.push(script.outro, "");
  return out.join("\n");
}

/** The chapter list for the video's description: starts at 0:00, then each step that names a chapter. */
export function makeChapters(script: Script, timeline: Timeline): { text: string; warnings: string[] } {
  const chapters = [{ ms: 0, name: "Introduction" }];
  for (const t of timeline.steps) if (t.chapter) chapters.push({ ms: t.startMs, name: t.chapter });
  // A first chapter that starts within ten seconds takes over the opening, rather than leave a too-short Introduction.
  if (chapters.length > 1 && chapters[1].ms < 10000) chapters.splice(0, 2, { ms: 0, name: chapters[1].name });
  const warnings: string[] = [];
  if (chapters.length < 3) warnings.push("Video sites show chapters only when there are at least three. Add chapter names to more steps.");
  for (let k = 0; k < chapters.length; k++) {
    const end = k + 1 < chapters.length ? chapters[k + 1].ms : timeline.durationMs;
    if (end - chapters[k].ms < 10000) warnings.push(`The chapter "${chapters[k].name}" is shorter than 10 seconds; video sites may not show the chapters.`);
  }
  void script;
  return { text: chapters.map((c) => `${clock(c.ms)} ${c.name}`).join("\n") + "\n", warnings };
}
