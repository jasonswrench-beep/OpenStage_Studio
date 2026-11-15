// The acceptance test for repeatable takes: make the same script into a video twice, from scratch each time (new
// narration, a new take), and check that both runs give the same video.
//
// Four things are compared, from the inside out:
//   1. the take: the same still pictures, in the same order, for every step
//   2. the timeline: every picture, pointer place, click, callout and clip at the same frame
//   3. what went into the encoder: every frame's pixels and every sound sample (fingerprints from the assembly)
//   4. the finished MP4 files, read back with Windows' own decoder and compared frame by frame
//
// node src/pipeline/check-repeat.ts <script.json> [--monitor <n>]

import { rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { helperPath, runHelper } from "./helper.ts";
import { makeVideo, ROOT, type MadeVideo } from "./make-video.ts";

export async function checkRepeat(scriptPath: string, log: (s: string) => void = console.log, monitor?: number): Promise<boolean> {
  const name = basename(scriptPath, ".json");
  const base = resolve(ROOT, "renders", `${name}-repeat`);
  rmSync(base, { recursive: true, force: true });
  const runs: MadeVideo[] = [];
  for (const run of ["first", "second"]) {
    log(`\n=== The ${run} run ===`);
    const folder = join(base, run);
    runs.push(await makeVideo(scriptPath, folder, { log, clipDir: join(folder, "narration"), monitor }));
  }
  const [a, b] = runs;
  const lines: string[] = [`Repeat check for ${basename(scriptPath)}`, ""];
  let same = true;
  const check = (ok: boolean, what: string) => {
    same &&= ok;
    lines.push(`${ok ? "SAME" : "DIFFERENT"}: ${what}`);
  };

  const pictures = (m: MadeVideo) => JSON.stringify([m.take.start, ...m.take.steps.map((s) => [s.hover, ...s.changes])]);
  check(pictures(a) === pictures(b), `the take's still pictures (${a.take.steps.length} steps)`);
  check(JSON.stringify(a.timeline) === JSON.stringify(b.timeline), `the timeline (${a.timeline.frames} and ${b.timeline.frames} frames, ${(a.timeline.durationMs / 1000).toFixed(1)} seconds)`);
  check(a.frameDigest === b.frameDigest, `every frame given to the encoder (fingerprints ${a.frameDigest} and ${b.frameDigest})`);
  check(a.soundDigest === b.soundDigest, `the sound given to the encoder (fingerprints ${a.soundDigest} and ${b.soundDigest})`);
  const compared = await runHelper(helperPath(ROOT), ["compare", "--a", a.video, "--b", b.video]);
  const c = compared.find((e) => e.event === "compared")!;
  check(c.same === true, `the finished videos, read back: ${c.message}`);

  lines.push("", same ? "PASS: running the script twice gave the same video." : "FAIL: the two runs differ (see above).");
  const report = lines.join("\n") + "\n";
  writeFileSync(join(base, "repeat-report.txt"), report);
  log(`\n${report}`);
  log(`The two videos and this report are in ${base}`);
  return same;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const script = process.argv[2];
  if (!script) {
    console.error("Say which script to check.");
    process.exit(2);
  }
  const at = process.argv.indexOf("--monitor");
  checkRepeat(resolve(script), console.log, at > 0 ? Number(process.argv[at + 1]) : undefined).then(
    (ok) => process.exit(ok ? 0 : 1),
    (e) => {
      console.error(`\nThe check could not finish: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
