// The acceptance test for phase 4 (batch and re-record), as the spec states it:
//
//   1. A full manual records unattended: the queue plans, writes, rehearses and records every video of the invented
//      Practice Planner manual, with nobody at the computer.
//   2. After a deliberate interface change (Practice Planner version 2, sample-program/versions.ts), the release check
//      names the exact broken steps: for every script, the first step that uses a control version 2 renamed, and no
//      others. The expected steps are worked out here from the scripts and the list of changes, not from the report.
//
// Everything goes into renders\batch-check\ (its own series and renders), so nothing else is touched. It uses the AI
// Set Up AI.bat chose. No video is approved: a person does that.
//
// node src/batch/check-batch.ts

import { rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Script, Step } from "../script/format.ts";
import { VERSION_2_CHANGES } from "../../sample-program/versions.ts";
import { runQueue } from "./queue.ts";
import { releaseCheck } from "./release.ts";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** The control a step needs on screen: its target (for actions that have one) and its callout's control. */
function controlsOf(s: Step): string[] {
  const out: string[] = [];
  if (s.target && s.action !== "open" && s.action !== "wait") out.push(s.target);
  const c = s.callout as { around?: string; to?: string; near?: string } | undefined;
  if (c) out.push(...[c.around, c.to, c.near].filter((x): x is string => !!x));
  return out;
}

/** The first step (counting from 1) a version change breaks, or null if none. */
export function expectedBreak(script: Script, renamed: string[]): number | null {
  const i = script.steps.findIndex((s) => controlsOf(s).some((c) => renamed.includes(c)));
  return i < 0 ? null : i + 1;
}

export async function checkBatch(log: (s: string) => void = console.log): Promise<boolean> {
  const base = join(ROOT, "renders", "batch-check");
  rmSync(base, { recursive: true, force: true });
  const seriesRoot = join(base, "series");
  const rendersRoot = join(base, "renders");
  const lines = ["Batch acceptance check", ""];
  let pass = true;
  const result = (ok: boolean, what: string) => {
    pass &&= ok;
    lines.push(`${ok ? "PASS" : "FAIL"}: ${what}`);
    log(`${ok ? "PASS" : "FAIL"}: ${what}`);
  };

  // 1. The whole manual, unattended.
  log("\n=== 1. The whole manual, unattended ===");
  const manual = join(ROOT, "examples", "manuals", "Practice Planner Guide.openexplainer");
  const q = await runQueue([manual], { seriesRoot, rendersRoot, log });
  const planned = q.chapters.reduce((n, c) => n + c.videos, 0);
  const recorded = q.items.filter((i) => i.outcome === "recorded");
  result(planned > 0 && recorded.length === planned, `the manual recorded unattended: ${recorded.length} of ${planned} planned video(s) made, with ${q.ai}`);
  for (const i of q.items.filter((x) => x.outcome !== "recorded")) lines.push(`  ${relative(ROOT, i.entry.file)}: ${i.outcome}${i.error ? ` (${i.error})` : ""}${i.check?.broken ? ` (step ${i.check.broken.step}: ${i.check.broken.error})` : ""}`);

  // 2. A new version with two renamed controls: the release check must name exactly the steps they break.
  log("\n=== 2. The release check after a deliberate interface change ===");
  const renamed = VERSION_2_CHANGES.map((c) => c.was);
  const handWritten = join(ROOT, "examples", "plan-a-lesson.json");
  const before = process.env.PRACTICE_PLANNER_VERSION;
  process.env.PRACTICE_PLANNER_VERSION = "2";
  let r;
  try {
    r = await releaseCheck([...q.chapters.flatMap((c) => (c.folder ? [c.folder] : [])), handWritten], { log, reportFile: join(base, "release-report.txt") });
  } finally {
    if (before === undefined) delete process.env.PRACTICE_PLANNER_VERSION;
    else process.env.PRACTICE_PLANNER_VERSION = before;
  }
  let expectedBroken = 0;
  let matched = 0;
  for (const x of r.results) {
    const expected = x.entry.script ? expectedBreak(x.entry.script, renamed) : null;
    const actual = x.check ? (x.check.works ? null : x.check.broken!.step) : undefined;
    if (expected !== null) expectedBroken++;
    const ok = actual === expected;
    if (ok) matched++;
    lines.push(`  ${ok ? "right" : "WRONG"}: ${relative(ROOT, x.entry.file)}: expected ${expected === null ? "no broken step" : `step ${expected}`}, reported ${actual === undefined ? `not checked (${x.skipped})` : actual === null ? "no broken step" : `step ${actual}`}`);
  }
  result(expectedBroken > 0 && matched === r.results.length, `the release check named exactly the broken steps: ${matched} of ${r.results.length} script(s) right, ${expectedBroken} expected to break (${VERSION_2_CHANGES.map((c) => c.about).join(" ")})`);
  const repaired = r.broken.filter((b) => b.check?.repairedFile).length;
  lines.push(`  Repaired copies proposed: ${repaired} of ${r.broken.length} (saved beside the scripts; never recorded).`);

  lines.push("", pass ? "PASS: a manual records unattended, and the release check names the exact broken steps." : "FAIL: see above.", "",
    "The queue report, the release report, the series and the videos are in renders\\batch-check.");
  writeFileSync(join(base, "batch-check-report.txt"), lines.join("\n") + "\n");
  log(`\n${lines.join("\n")}`);
  return pass;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkBatch().then(
    (ok) => process.exit(ok ? 0 : 1),
    (e) => {
      console.error(`\nThe check could not finish: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    },
  );
}
