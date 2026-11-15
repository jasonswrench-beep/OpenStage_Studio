// Small changes to a script's text that keep the rest of it exactly as its writer laid it out. Scripts are written by
// hand, so rewriting the whole file would lose its layout; only the part that changes is touched.

import type { Redaction } from "./format.ts";
import { SCRIPT_VERSION } from "./format.ts";
import { validateScript } from "./validate.ts";

/** One blurred box, on one line. */
export function redactionLine(r: Redaction): string {
  return `{ "box": [${r.box.join(", ")}], "fromStep": ${r.fromStep}, "toStep": ${r.toStep}${r.reason ? `, "reason": ${JSON.stringify(r.reason)}` : ""} }`;
}

/** Where a top-level key's value starts and ends in a script's text (the value's first and after-last character). */
function valueSpan(text: string, key: string): [number, number] | null {
  // Walk the text, tracking strings and depth, to find the key at the top level only.
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      if (depth === 1 && text.slice(i + 1, end) === key) {
        let j = end + 1;
        while (/\s/.test(text[j])) j++;
        if (text[j] !== ":") return null;
        j++;
        while (/\s/.test(text[j])) j++;
        return [j, valueEnd(text, j)];
      }
      i = end;
    } else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
  }
  return null;
}

function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i;
  }
  return text.length;
}

function valueEnd(text: string, start: number): number {
  if (text[start] === '"') return stringEnd(text, start) + 1;
  if (text[start] !== "{" && text[start] !== "[") {
    let i = start;
    while (i < text.length && !/[,}\]\s]/.test(text[i])) i++;
    return i;
  }
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"') i = stringEnd(text, i);
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** The script's text with a blurred box added (and brought up to the current version if it was older). The same box over
 * the same steps is not added twice. Throws if the script does not pass the format check afterwards. */
export function addRedaction(text: string, r: Redaction): string {
  const parsed = JSON.parse(text) as { redactions?: Redaction[]; version?: number };
  const existing = parsed.redactions ?? [];
  if (existing.some((e) => e.box.join() === r.box.join() && e.fromStep === r.fromStep && e.toStep === r.toStep)) return text;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const all = [...existing, r];
  const block = `[${newline}${all.map((x) => `    ${redactionLine(x)}`).join(`,${newline}`)}${newline}  ]`;
  let out: string;
  const span = valueSpan(text, "redactions");
  if (span) out = text.slice(0, span[0]) + block + text.slice(span[1]);
  else {
    const steps = valueSpan(text, "steps");
    if (!steps) throw new Error("The script has no steps to put the blurred box before.");
    // Put the new key on its own line just before "steps", indented as "steps" is.
    const keyStart = text.lastIndexOf('"steps"', steps[0]);
    const lineStart = text.lastIndexOf("\n", keyStart) + 1;
    const indent = text.slice(lineStart, keyStart).match(/^\s*/)?.[0] ?? "  ";
    out = `${text.slice(0, keyStart)}"redactions": ${block},${newline}${indent}${text.slice(keyStart)}`;
  }
  if (typeof parsed.version === "number" && parsed.version < SCRIPT_VERSION) {
    const v = valueSpan(out, "version");
    if (v) out = out.slice(0, v[0]) + String(SCRIPT_VERSION) + out.slice(v[1]);
  }
  const check = validateScript(JSON.parse(out));
  if (!check.ok) throw new Error(`The blurred box could not be added: ${check.errors.map((e) => `${e.path}: ${e.message}`).join(" ")}`);
  return out;
}
