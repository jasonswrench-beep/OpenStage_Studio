// Finding the scripts a batch run or a release check works on: the scripts of series folders (from their plan.json,
// leaving out cut videos), any other folder's scripts, and single script files. A repaired copy (.repaired.json) is never
// picked up: it waits for a person to read it.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Plan } from "../ai/series.ts";
import { SCRIPT_FORMAT, type Script } from "../script/format.ts";
import { validateScript } from "../script/validate.ts";

export interface ScriptEntry {
  file: string;
  /** The script, if it passes the format check. */
  script?: Script;
  /** Why it does not, if it does not. */
  problem?: string;
  /** The series and video it belongs to, if any. */
  series?: { folder: string; video: string };
  /** The name of its folder under renders. */
  renderName: string;
}

export const isRepairedCopy = (file: string) => /\.repaired\.json$/i.test(file);

/** A fingerprint of a script file, so a video made from it is known to be made from exactly this version. */
export function fileDigest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function entry(file: string, series?: ScriptEntry["series"]): ScriptEntry | null {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if ((data as { format?: unknown })?.format !== SCRIPT_FORMAT) return null;
  const v = validateScript(data);
  const name = basename(file, ".json");
  return {
    file,
    ...(v.ok ? { script: v.script } : { problem: v.errors.map((e) => `${e.path}: ${e.message}`).join(" ") }),
    ...(series ? { series } : {}),
    renderName: series ? `${basename(series.folder)}-${name}` : name,
  };
}

/** Every script under the given paths, each once, in a steady order. */
export function collectScripts(paths: string[]): ScriptEntry[] {
  const out: ScriptEntry[] = [];
  const seen = new Set<string>();
  const add = (e: ScriptEntry | null) => {
    if (!e || seen.has(e.file.toLowerCase())) return;
    seen.add(e.file.toLowerCase());
    out.push(e);
  };
  const walk = (path: string) => {
    if (!existsSync(path)) return;
    if (statSync(path).isFile()) {
      if (path.toLowerCase().endsWith(".json") && !isRepairedCopy(path)) add(entry(path));
      return;
    }
    const planFile = join(path, "plan.json");
    if (existsSync(planFile)) {
      const plan = JSON.parse(readFileSync(planFile, "utf8")) as Plan;
      for (const v of plan.videos) if (v.script && v.status !== "cut") add(entry(join(path, v.script), { folder: path, video: v.title }));
      return;
    }
    for (const d of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (d.name.startsWith(".") || d.name === "node_modules") continue;
      walk(join(path, d.name));
    }
  };
  for (const p of paths) walk(resolve(p));
  return out;
}
