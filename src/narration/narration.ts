// Narration: which lines are spoken, how product names and acronyms are said, and where each clip is kept.
//
// One clip per line. A clip's file name comes from everything that shapes its sound (engine, voice, rate, and the text as
// spoken), so changing one line makes one new clip and every other clip is reused.

import type { Script } from "../script/format.ts";

/** The narration engines: Kokoro, a local speech model run inside the helper (the default, docs/voice-models.md), or the
 * voices built into Windows. Recording your own voice is part of the format but not built yet. */
export const ENGINES = ["kokoro", "windows", "recorded"] as const;
export type Engine = (typeof ENGINES)[number];

export interface VoiceSettings {
  engine: Engine;
  /** For Kokoro, a voice's name (`af_heart`); for Windows, `default` or part of a voice's name. */
  voice: string;
  /** 1 is normal speed. */
  rate: number;
  /** The model's pinned revision, so a new model makes new clips. Filled in by the pipeline. */
  model?: string;
}

export const DEFAULT_VOICE: VoiceSettings = { engine: "kokoro", voice: "af_heart", rate: 1 };

/** How a term is said: `{ "OpenStage": "Open Stage" }`. Whole words, capital letters ignored. */
export type Pronunciations = Record<string, string>;

export interface NarrationLine {
  /** `intro`, `outro` or `step-<index>`. */
  id: string;
  /** What the captions show. */
  text: string;
  /** What the voice is given. */
  spoken: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text as the voice should say it: each listed term replaced by how it is said, longest terms first. */
export function applyPronunciations(text: string, list: Pronunciations): string {
  const terms = Object.keys(list).filter((t) => t.trim() !== "").sort((a, b) => b.length - a.length);
  let out = text;
  for (const term of terms) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, "giu"), list[term]);
  }
  return out;
}

export function narrationLines(script: Script, pronunciations: Pronunciations = {}): NarrationLine[] {
  const lines: NarrationLine[] = [];
  const add = (id: string, text: string | undefined) => {
    if (text && text.trim()) lines.push({ id, text, spoken: applyPronunciations(text, pronunciations) });
  };
  add("intro", script.intro);
  script.steps.forEach((s, i) => add(`step-${i}`, s.silent ? undefined : s.narration));
  add("outro", script.outro);
  return lines;
}

/** What a clip's sound depends on, as one string to fingerprint for its file name. */
export function clipKey(line: NarrationLine, voice: VoiceSettings): string {
  return JSON.stringify({ engine: voice.engine, voice: voice.voice, rate: voice.rate, ...(voice.model ? { model: voice.model } : {}), text: line.spoken });
}
