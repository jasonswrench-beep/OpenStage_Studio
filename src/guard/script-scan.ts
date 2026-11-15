// The script scan: checks every piece of text a script will put on screen or say (the narration, typed values, callout
// labels, card text, chapter names, the description) against the blocklist, before anything is recorded. A hit stops the
// script: change the words, or, if the name is your own, add it to the allowlist.

import type { Script } from "../script/format.ts";
import { CATEGORIES, findHits, type Blocklist, type Hit } from "./blocklist.ts";

export interface ScriptHit extends Hit {
  /** Where in the script, such as `steps[3].value`. */
  path: string;
  /** The whole text that was checked. */
  text: string;
}

/** Fields whose words a viewer sees or hears: on the cards, spoken, typed or shown on screen, or in the description. */
const SHOWN = new Set(["title", "goal", "intro", "outro", "narration", "value", "text", "chapter", "description", "tags", "name"]);
/** Parts of a script for people only, never shown: who wrote it, notes, what rehearsal checks, why a box is blurred. */
const FOR_PEOPLE = /^(writtenBy|startState\.note|redactions)|\.(expect|note|reason)$/;

/** Every piece of text in the script that a viewer could see or hear, with where it is. */
export function scriptTexts(script: Script | Record<string, unknown>): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (v: unknown, path: string, key: string) => {
    if (typeof v === "string") {
      if (SHOWN.has(key) && !FOR_PEOPLE.test(path)) out.push({ path, text: v });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, k);
  };
  walk(script, "", "");
  return out;
}

export function scanScript(script: Script | Record<string, unknown>, list: Blocklist): ScriptHit[] {
  return scriptTexts(script).flatMap(({ path, text }) => findHits(text, list).map((h) => ({ ...h, path, text })));
}

/** One line per hit, for a person to read. */
export function describeScriptHit(h: ScriptHit): string {
  const what = h.how === "pattern" ? h.term : `"${h.term}" (${CATEGORIES[h.category].toLowerCase()})`;
  const close = h.how === "close" || h.how === "partial" ? ` (read as "${h.found}")` : "";
  return `Blocked at ${h.path}: ${what}${h.how === "pattern" ? `: "${h.found}"` : close}.${h.note ? ` ${h.note}` : ""}`;
}
