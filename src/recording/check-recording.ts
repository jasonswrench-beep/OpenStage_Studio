// Check Recording.bat: the acceptance test for development list item 1 (Studio reads C1 recordings as well as manuals).
//
//   1. The invented example recording (examples/recordings/plan-a-lesson.capture) is read with the shared core's reader
//      and turned into a draft script; every step's control must be found in Practice Planner, through its hook.
//   2. The script must be the one the recording shows: the right steps, in order, with nothing done in another program.
//   3. The script is made into a video twice, and the two must be the same (the repeat check), so a recording gives a
//      video that can be made again after a new version of the program.
//
// Everything goes into renders\recording-check\. Opens Practice Planner on the take screen.
//
// node src/recording/check-recording.ts

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkRepeat } from "../pipeline/check-repeat.ts";
import { appRoot, workspace } from "../paths.ts";
import { isMain } from "../util/is-main.ts";
import { importRecording } from "./import.ts";

export async function checkRecording(log: (s: string) => void = console.log): Promise<boolean> {
  const base = join(workspace(), "renders", "recording-check");
  rmSync(base, { recursive: true, force: true });
  const lines: string[] = [];
  let pass = true;
  const check = (ok: boolean, what: string) => {
    pass &&= ok;
    lines.push(`${ok ? "PASS" : "FAIL"}: ${what}`);
    log(lines[lines.length - 1]);
  };
  const r = await importRecording(join(appRoot(), "examples", "recordings", "plan-a-lesson.capture"), { outFolder: base, title: "Plan a lesson, from a recording", log });
  check(r.resolved, "every step's control was found in Practice Planner and named by its stable id");
  check(!r.problems.length, `the script passes the format check${r.problems.length ? ` (${r.problems.join(" ")})` : ""}`);
  const steps = r.draft.script.steps.length;
  const got = (await import("node:fs")).readFileSync(r.file, "utf8");
  const s = JSON.parse(got) as { steps: { action: string; target?: string; value?: string }[] };
  const expected = [
    ["click", "toolbar.lesson.new"], ["type", "editor.title", "Sorting leaves by shape"], ["type", "editor.subject", "Science"],
    ["type", "editor.length", "30 minutes"], ["type", "editor.notes", "Collect ten leaves."], ["click", "toolbar.settings"],
    ["click", "dialog.settings.share"], ["click", "dialog.settings.ok"], ["key", undefined, "Ctrl+S"],
  ];
  const brief = s.steps.map((x) => [x.action, x.target, x.value]);
  const same = JSON.stringify(brief.map((b) => b.filter((v) => v !== undefined))) === JSON.stringify(expected.map((b) => b.filter((v) => v !== undefined)));
  check(same, `the script holds the ${expected.length} steps the recording shows, in order (it has ${steps})`);
  check(r.draft.notes.some((n) => /otherapp\.exe came in front/.test(n)) && !got.includes("Dismiss"), "what was done in another program is left out, and said so");
  log("\nMaking the video twice from the script...");
  const repeated = await checkRepeat(r.file, log);
  check(repeated, "the video made from the recording's script is the same both times");
  const report = [...lines, "", pass ? "PASS: a recording becomes a script Studio performs again, the same every time." : "FAIL: see above."].join("\n") + "\n";
  writeFileSync(join(base, "recording-check-report.txt"), report);
  log(`\n${report}`);
  return pass;
}

if (isMain(import.meta.url)) {
  checkRecording().then(
    (ok) => process.exit(ok ? 0 : 1),
    (e) => {
      console.error(`\nThe check could not finish: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
