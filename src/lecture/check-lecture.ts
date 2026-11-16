// Check Lecture.bat: the acceptance test for development list item 3 (a lecture mode).
//
//   1. The example notes (examples/lectures/how-seeds-become-plants.md) become a lecture by Studio's fixed rules (no AI),
//      with the slides the example lecture holds.
//   2. The lecture is refused for a video until approved; a scratch copy is approved here (the lecture script only: no
//      video review is ever approved by a tool), and a change to its words after approval is refused again.
//   3. The approved copy is made into a video twice; the two must be the same, frame for frame and in sound, and have
//      captions, a description track that describes every slide, a transcript, chapters, a review and a thumbnail.
//
// Everything goes into renders\lecture-check\. Opens no program window.
//
// node src/lecture/check-lecture.ts

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { helperPath, runHelper } from "../pipeline/helper.ts";
import { appRoot, workspace } from "../paths.ts";
import { isMain } from "../util/is-main.ts";
import type { Lecture } from "./format.ts";
import { approveLecture, writeLecture } from "./write.ts";
import { makeLecture } from "./make-lecture.ts";

export async function checkLecture(log: (s: string) => void = console.log): Promise<boolean> {
  const base = join(workspace(), "renders", "lecture-check");
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const lines: string[] = [];
  let pass = true;
  const check = (ok: boolean, what: string) => {
    pass &&= ok;
    lines.push(`${ok ? "PASS" : "FAIL"}: ${what}`);
    log(lines[lines.length - 1]);
  };
  const examples = join(appRoot(), "examples", "lectures");
  const written = await writeLecture(join(examples, "how-seeds-become-plants.md"), { useAi: false, outFolder: base, log });
  const example = JSON.parse(readFileSync(join(examples, "how-seeds-become-plants.json"), "utf8")) as Lecture;
  check(JSON.stringify(written.lecture.slides) === JSON.stringify(example.slides), `the notes became the example's ${example.slides.length} slides by Studio's rules`);

  // The example itself, with its intro and outro, in a scratch folder with the project's settings.
  const file = join(base, "seeds.json");
  copyFileSync(join(examples, "how-seeds-become-plants.json"), file);
  copyFileSync(join(appRoot(), "examples", "studio-project.json"), join(base, "studio-project.json"));
  let refused = "";
  try {
    await makeLecture(file, { log: () => undefined });
  } catch (e) {
    refused = e instanceof Error ? e.message : String(e);
  }
  check(/approves the lecture/.test(refused), "a lecture nobody has approved is not made into a video");
  approveLecture(file, "the lecture check");
  const approved = readFileSync(file, "utf8");
  const changed = JSON.parse(approved) as Lecture;
  changed.slides[0].narration += " One more sentence.";
  writeFileSync(join(base, "changed.json"), JSON.stringify(changed, null, 2));
  let refusedAgain = "";
  try {
    await makeLecture(join(base, "changed.json"), { log: () => undefined });
  } catch (e) {
    refusedAgain = e instanceof Error ? e.message : String(e);
  }
  check(/changed since/.test(refusedAgain), "a lecture changed after its approval is refused until approved again");

  log("\nMaking the lecture video twice...");
  const made = [];
  for (const run of ["first", "second"]) {
    made.push(await makeLecture(file, { outFolder: join(base, run), clipDir: join(base, run, "narration"), log }));
  }
  const [a, b] = made;
  check(a.frameDigest === b.frameDigest, `every frame the same both times (${a.frameDigest} and ${b.frameDigest})`);
  check(a.soundDigest === b.soundDigest, "the sound the same both times");
  const compared = await runHelper(helperPath(), ["compare", "--a", a.video, "--b", b.video]);
  const c = compared.find((e) => e.event === "compared")!;
  check(c.same === true, `the finished videos, read back: ${c.message}`);
  const has = (f: string) => existsSync(join(a.folder, f));
  check(["captions.srt", "captions.vtt", "descriptions.vtt", "transcript.txt", "chapters.txt", "thumbnail.png", "review.json", "publish.json"].every(has), "captions, the description track, transcript, chapters, thumbnail, review and publishing details were made");
  const descriptions = readFileSync(join(a.folder, "descriptions.vtt"), "utf8");
  check(example.slides.every((s, i) => descriptions.includes(`Slide ${i + 1}: ${s.title}`)), "the description track describes every slide");
  check(readFileSync(join(a.folder, "transcript.txt"), "utf8").includes(example.slides[2].narration), "the transcript has what is said");
  const report = [...lines, "", pass ? "PASS: notes become an approved lecture and a repeatable video with captions and descriptions." : "FAIL: see above."].join("\n") + "\n";
  writeFileSync(join(base, "lecture-check-report.txt"), report);
  log(`\n${report}`);
  return pass;
}

if (isMain(import.meta.url)) {
  checkLecture().then(
    (ok) => process.exit(ok ? 0 : 1),
    (e) => {
      console.error(`\nThe check could not finish: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
