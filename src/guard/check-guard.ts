// The acceptance test for phase 2 (guard and package), as the spec states it:
//
//   1. A test script that types a blocked name is stopped at the script scan.
//   2. A frame showing a planted file path is flagged.
//   3. Export stays disabled until the flag is resolved.
//
// It never approves anything: a person does that, in the app. It only checks that export is refused while the flag is
// open, and that a refused export makes nothing.
//
// node src/guard/check-guard.ts [--monitor <n>]

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeVideo, ROOT, ScriptBlocked, takeMonitor } from "../pipeline/make-video.ts";
import { exportAll, refusal } from "../package/export.ts";
import { gate } from "./review.ts";

export async function checkGuard(monitor: number, log: (s: string) => void = console.log): Promise<boolean> {
  const base = join(ROOT, "renders", "guard-check");
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const lines: string[] = ["Guard acceptance check", ""];
  let pass = true;
  const result = (ok: boolean, what: string) => {
    pass &&= ok;
    lines.push(`${ok ? "PASS" : "FAIL"}: ${what}`);
    log(`${ok ? "PASS" : "FAIL"}: ${what}`);
  };

  // 1. The script scan stops a blocked name before anything is recorded.
  log("\n=== 1. A script that types a blocked name ===");
  const blockedFolder = join(base, "blocked-name");
  let stopped = false;
  try {
    await makeVideo(join(ROOT, "examples/guard/blocked-name.json"), blockedFolder, { monitor, log, blocklists: [join(ROOT, "examples/guard/test-blocklist.json")] });
  } catch (e) {
    stopped = e instanceof ScriptBlocked;
    if (!stopped) throw e;
  }
  result(stopped && !existsSync(blockedFolder), "the script that types a blocked name was stopped at the script scan, and nothing was recorded");

  // 2. The frame scan flags a planted path that only shows on screen.
  log("\n=== 2. A frame showing a planted file path ===");
  const plantedFolder = join(base, "planted-path");
  const made = await makeVideo(join(ROOT, "examples/guard/planted-path.json"), plantedFolder, { monitor, log, clipDir: join(base, "narration") });
  const review = made.review!;
  const planted = review.flags.find((f) => f.category === "path" && f.found.includes("dana.whitfield"));
  result(!!planted, planted
    ? `the planted path was flagged ("${planted.found}", first at frame ${planted.shown[0][0]}, ${new Set(planted.sightings.map((s) => s.source)).size === 2 ? "read from the picture and reported by the program" : `found by ${planted.sightings[0].source}`})`
    : "the planted path was not flagged");
  result(!review.flags.some((f) => !f.found.includes("dana.whitfield")), `nothing else was flagged (${review.flags.length} flag${review.flags.length === 1 ? "" : "s"} in all)`);

  // 3. Export stays shut while the flag is open, and a refused export makes nothing.
  log("\n=== 3. Export while the flag is open ===");
  const g = gate(review);
  const why = refusal(plantedFolder);
  result(!g.open && why !== null, `export is shut: ${why}`);
  const out = join(base, "packages");
  const { exported } = exportAll([plantedFolder], out, log);
  result(exported.length === 0 && !existsSync(join(out, "checklist.txt")), "trying to export anyway made no package");

  lines.push("", pass ? "PASS: the guard stops, flags and holds as the spec asks." : "FAIL: see above.", "",
    "To finish by hand: open the review (Review Video.bat, renders\\guard-check\\planted-path), decide the flag, approve, and export.");
  writeFileSync(join(base, "guard-check-report.txt"), lines.join("\n") + "\n");
  log(`\n${pass ? "PASS" : "FAIL"}. The report is in ${join(base, "guard-check-report.txt")}`);
  return pass;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--monitor");
  checkGuard(takeMonitor(at > 0 ? process.argv[at + 1] : undefined)).then(
    (ok) => process.exit(ok ? 0 : 1),
    (e) => {
      console.error(`\nThe check could not finish: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
