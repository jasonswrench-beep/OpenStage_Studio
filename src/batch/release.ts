// The release check: after a new version of a program, rehearse every script for it (nothing is recorded, nothing is
// changed) and name the exact step in each that can no longer be performed. With an AI chosen, each broken script also
// gets a repaired copy beside it to read. The report is in renders\release-check\report.txt.
//
// node src/batch/release.ts [<series folder, folder of scripts, or script>...]
// With nothing named: every series under series\ and every script under examples\.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openAnswerer, type Answerer } from "../ai/ask.ts";
import { programFacts, type ProgramFacts } from "../ai/series.ts";
import { describeChoice, readAiSettings } from "../ai/settings.ts";
import { FRAME, takeMonitor } from "../pipeline/make-video.ts";
import { openProgram } from "../pipeline/program-session.ts";
import { checkScript, stepWords, type ScriptCheck } from "./check-script.ts";
import { collectScripts, type ScriptEntry } from "./scripts.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface ReleaseResult {
  entry: ScriptEntry;
  check?: ScriptCheck;
  /** Why it was not checked (not a valid script, or its program would not start). */
  skipped?: string;
}

export interface ReleaseReport {
  results: ReleaseResult[];
  broken: ReleaseResult[];
  text: string;
}

export async function releaseCheck(paths: string[], o: { log?: (s: string) => void; useAi?: boolean; reportFile?: string } = {}): Promise<ReleaseReport> {
  const log = o.log ?? console.log;
  const entries = collectScripts(paths);
  if (!entries.length) throw new Error("No scripts were found to check.");
  const settings = readAiSettings();
  const answerer: Answerer | null = o.useAi === false || settings.choice === "none" ? null : await openAnswerer(settings, log);
  const results: ReleaseResult[] = [];
  try {
    const byProgram = new Map<string, ScriptEntry[]>();
    for (const e of entries) {
      if (!e.script) {
        results.push({ entry: e, skipped: `It is not a valid script: ${e.problem}` });
        continue;
      }
      const k = `${e.script.program.id}|${e.script.driver ?? "hook"}`;
      byProgram.set(k, [...(byProgram.get(k) ?? []), e]);
    }
    for (const [key, list] of byProgram) {
      const [programId, driver] = key.split("|") as [string, "hook" | "accessibility"];
      let session;
      try {
        session = await openProgram(ROOT, programId, takeMonitor(), log, driver);
      } catch (e) {
        for (const x of list) results.push({ entry: x, skipped: `The program could not be started: ${e instanceof Error ? e.message : String(e)}` });
        continue;
      }
      try {
        let facts: ProgramFacts | null = null;
        try {
          facts = await programFacts(session);
        } catch {
          facts = null;
        }
        for (const x of list) {
          log(`Checking ${relative(ROOT, x.file)}.`);
          try {
            const check = await checkScript(session, x.file, x.script!, { facts, answerer, frame: FRAME, log });
            results.push({ entry: x, check });
            log(check.works ? "  Still works." : `  BROKEN at step ${check.broken!.step}: ${check.broken!.error}`);
          } catch (e) {
            results.push({ entry: x, skipped: `It could not be checked: ${e instanceof Error ? e.message : String(e)}` });
          }
        }
      } finally {
        await session.close();
      }
    }
  } finally {
    await answerer?.close();
  }
  const broken = results.filter((r) => r.check && !r.check.works);
  const text = releaseText(results, answerer ? describeChoice(settings) : "no AI");
  const reportFile = o.reportFile ?? join(ROOT, "renders", "release-check", "report.txt");
  mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, text);
  return { results, broken, text };
}

export function releaseText(results: ReleaseResult[], ai: string): string {
  const name = (r: ReleaseResult) => relative(ROOT, r.entry.file);
  const broken = results.filter((r) => r.check && !r.check.works);
  const works = results.filter((r) => r.check?.works);
  const skipped = results.filter((r) => r.skipped);
  const lines = [
    "Release check",
    `Program versions: as installed now${process.env.PRACTICE_PLANNER_VERSION ? ` (Practice Planner version ${process.env.PRACTICE_PLANNER_VERSION})` : ""}. Repairs proposed by: ${ai}.`,
    "",
    `${results.length} script(s): ${works.length} still work, ${broken.length} broken, ${skipped.length} not checked.`,
  ];
  if (broken.length) {
    lines.push("", "BROKEN (the first step in each that can no longer be performed):");
    for (const r of broken) {
      const b = r.check!.broken!;
      lines.push(`- ${name(r)}${r.entry.series ? ` ("${r.entry.series.video}")` : ""}, step ${b.step}${b.what ? `: ${stepWords(b.what)}` : ""}`);
      if (b.what?.narration) lines.push(`    Narration: "${b.what.narration}"`);
      lines.push(`    Why: ${b.error}`);
      lines.push(r.check!.repairedFile
        ? `    A repaired copy passed rehearsal: ${relative(ROOT, r.check!.repairedFile)}. Read it; if it is right, replace the script with it, then record again.`
        : `    No repaired copy: ${r.check!.unrepaired}`);
    }
  }
  if (skipped.length) {
    lines.push("", "NOT CHECKED:");
    for (const r of skipped) lines.push(`- ${name(r)}: ${r.skipped}`);
  }
  if (works.length) {
    lines.push("", "STILL WORK:");
    for (const r of works) lines.push(`- ${name(r)}`);
  }
  return lines.join("\n") + "\n";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const paths = args.filter((a) => !a.startsWith("--"));
  releaseCheck(paths.length ? paths : [join(ROOT, "series"), join(ROOT, "examples")], { useAi: !args.includes("--no-ai") }).then(
    (r) => {
      console.log(`\n${r.text}`);
      console.log(`The report is in ${join(ROOT, "renders", "release-check", "report.txt")}`);
      process.exit(r.broken.length ? 1 : 0);
    },
    (e) => {
      console.error(`\nThe release check did not finish: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    },
  );
}
