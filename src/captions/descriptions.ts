// Audio description, as text (development list item 2; voicing it waits for the shared speech engine, C5:
// CORE-REQUESTS.md S1). For a viewer who cannot see the screen, what the narration does not say: the cards' words, the
// words typed, a callout's label, the keys pressed, and what the script's author wrote in a step's `describe`.
//
// Written as `descriptions.vtt` (WebVTT, for a player's descriptions track, `kind="descriptions"`) and in the transcript.
// Made from the script and the timeline only, with fixed rules, so the same script always gives the same descriptions.

import type { Script, Step } from "../script/format.ts";
import { parseKey } from "../script/format.ts";
import { endCard, titleCard, type Timeline } from "../timeline/build.ts";
import { captionLines, type Caption } from "./captions.ts";

export interface Description {
  startMs: number;
  endMs: number;
  text: string;
  /** Which step it belongs to (counting from 1), or the card. */
  of: number | "title" | "end";
}

const sentence = (s: string) => {
  const t = s.trim();
  return t ? (/[.!?]$/.test(t) ? t : `${t}.`) : "";
};

/** What a step shows that its narration may not say, by fixed rules, then the author's own words. */
export function stepDescription(step: Step, label?: string): string {
  const parts: string[] = [];
  if (step.action === "type" && step.value && !(step.narration ?? "").includes(step.value)) {
    parts.push(label ? `The words "${step.value}" are entered in ${label}.` : `The words "${step.value}" are typed.`);
  }
  if (step.action === "key") {
    const k = parseKey(step.value ?? "");
    if (k) parts.push(`The keys ${[...k.modifiers, k.key].join(" plus ")} show at the bottom of the screen.`);
  }
  if (step.callout?.type === "label") parts.push(`A label reads: ${sentence(step.callout.text)}`);
  if (step.describe) parts.push(sentence(step.describe));
  return parts.join(" ");
}

/** Every description, timed: the title card's, each step's from its action to its end, and the end card's. */
export function makeDescriptions(script: Script, timeline: Timeline, labels: (string | undefined)[] = []): Description[] {
  const out: Description[] = [];
  const firstStep = timeline.steps[0]?.startMs ?? timeline.durationMs;
  const title = titleCard(script);
  out.push({ startMs: 0, endMs: Math.max(1000, firstStep), of: "title", text: `Title card: ${title.title}. ${title.kicker}. ${sentence((title.lines ?? []).join(" "))}`.trim() });
  for (const t of timeline.steps) {
    const text = stepDescription(script.steps[t.index], labels[t.index]);
    if (text) out.push({ startMs: t.actionMs, endMs: Math.max(t.endMs, t.actionMs + 1000), of: t.index + 1, text });
  }
  const last = timeline.steps[timeline.steps.length - 1];
  const end = endCard(script);
  const endStart = last ? last.endMs : firstStep;
  out.push({ startMs: endStart, endMs: Math.max(timeline.durationMs, endStart + 1000), of: "end", text: `End card: ${end.title}. ${(end.lines ?? []).map(sentence).join(" ")}`.trim() });
  // Never two at once: one ends where the next begins.
  for (let k = 0; k + 1 < out.length; k++) out[k].endMs = Math.min(out[k].endMs, out[k + 1].startMs);
  return out.filter((d) => d.endMs > d.startMs);
}

/** The descriptions as WebVTT cues (the same file form as the captions, read by a player as a descriptions track). */
export function descriptionCaptions(ds: Description[]): Caption[] {
  return ds.map((d) => ({ startMs: d.startMs, endMs: d.endMs, lines: d.text.length <= 84 ? captionLines(d.text) : [d.text] }));
}
