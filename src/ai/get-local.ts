// Downloads the built-in AI model and its runtime (about 2.8 GB, once), with progress, carrying on from where an earlier
// try stopped. Every file is checked against tools/local-ai.json. Stop it any time with Ctrl+C; run it again to go on.
//
// node src/ai/get-local.ts [--yes]

import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { plan, progressText, sizeText } from "../narration/voice-download.ts";
import { downloadLocalAi, localAiFolder, localAiReady, readLocalManifest } from "./local.ts";

export async function getLocalAi(yes: boolean, log: (s: string) => void = console.log): Promise<boolean> {
  const m = readLocalManifest();
  const dir = localAiFolder(m);
  if (localAiReady(m, dir)) {
    log(`The built-in AI model is already downloaded (${dir}).`);
    return true;
  }
  const left = plan(dir, m).reduce((n, s) => n + (s.complete ? 0 : s.file.size - s.have), 0);
  log(`${m.name}.`);
  log(`Licences: ${m.licence}. It runs on this computer only; nothing you give it leaves the computer.`);
  log(`It needs ${sizeText(left)} to download, once, into ${dir}.`);
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("Download it now? Type Y and press Enter: ")).trim().toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      log("Nothing was downloaded.");
      return false;
    }
  }
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  let last = -1;
  try {
    await downloadLocalAi(m, {
      signal: stop.signal,
      onNote: log,
      onProgress: (p) => {
        const pct = p.total ? Math.floor((p.done / p.total) * 100) : 100;
        if (pct !== last) {
          last = pct;
          log(progressText(p).replace("the voice", "the AI model"));
        }
      },
    }, dir);
  } catch (e) {
    if (stop.signal.aborted) {
      log("Stopped. Run this again to carry on from where it stopped.");
      return false;
    }
    throw e;
  }
  log("The built-in AI model is downloaded and checked.");
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  getLocalAi(process.argv.includes("--yes")).then(
    (ok) => process.exit(ok ? 0 : 1),
    (e) => {
      console.error(`\nThe download did not finish: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
