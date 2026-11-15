// Gets the local voice (Kokoro-82M) for narration: says what will be downloaded, from where, and how big, then
// downloads it with progress. Ctrl+C stops it; running it again carries on where it stopped.
//
// node src/pipeline/get-voice.ts [--yes]

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { downloadVoice, plan, progressText, sizeText, voicesRoot, type VoiceManifest } from "../narration/voice-download.ts";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");

export function readManifest(): VoiceManifest {
  return JSON.parse(readFileSync(join(ROOT, "tools/kokoro-model.json"), "utf8")) as VoiceManifest;
}

async function main() {
  const m = readManifest();
  const dir = join(voicesRoot(), m.folder);
  const steps = plan(dir, m);
  const left = steps.reduce((n, s) => n + (s.complete ? 0 : s.file.size - s.have), 0);
  if (left === 0) {
    console.log(`The voice is already here (${dir}). Checking it...`);
  } else {
    console.log(`OpenStage Studio narrates with ${m.name}, a speech model that runs on this computer.`);
    console.log(`It downloads ${sizeText(left)} from ${m.source} (licence: ${m.licence}), into`);
    console.log(`  ${dir}`);
    console.log("Nothing from your projects is sent. Once downloaded, the voice works offline.");
    if (!process.argv.includes("--yes")) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question("Download it now? Type Y and press Enter: ")).trim().toLowerCase();
      rl.close();
      if (answer !== "y" && answer !== "yes") {
        console.log("Nothing was downloaded.");
        return;
      }
    }
  }
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  let last = -1;
  try {
    await downloadVoice(m, dir, {
      signal: stop.signal,
      onNote: (l) => console.log(l),
      onProgress: (p) => {
        const pct = Math.floor((p.done / p.total) * 100);
        if (pct !== last && (pct % 5 === 0 || pct === 100)) {
          last = pct;
          console.log(progressText(p));
        }
      },
    });
    console.log(`The voice is ready: ${m.files.length} files, all matching their checksums.`);
  } catch (e) {
    if (stop.signal.aborted) {
      console.log("\nStopped. What was downloaded is kept; run this again to carry on where it stopped.");
      process.exit(1);
    }
    throw e;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`\nThe voice was not downloaded: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
