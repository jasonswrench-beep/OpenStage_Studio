// Small helpers for the double-click scripts.
//
// node src/guard/cli.ts start-blocklist   start this computer's own blocklist (blocklist.local.json) if there is none
// node src/guard/cli.ts latest-review     print the folder of the most recently made video that has a review

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureLocalBlocklist } from "./load.ts";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function latestReview(root = ROOT): string | null {
  const renders = join(root, "renders");
  if (!existsSync(renders)) return null;
  const found = readdirSync(renders, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(renders, d.name, "review.json")))
    .map((d) => ({ folder: join(renders, d.name), at: statSync(join(renders, d.name, "review.json")).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  return found[0]?.folder ?? null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const what = process.argv[2];
  if (what === "start-blocklist") {
    const { path, made } = ensureLocalBlocklist(ROOT);
    console.log(made
      ? `Started your blocklist: ${path}\nAdd names under each category (another company's products, real people, institutions). It stays on this computer.`
      : `Your blocklist: ${path}`);
  } else if (what === "latest-review") {
    const folder = latestReview();
    if (folder) console.log(folder);
  } else {
    console.error("Say start-blocklist or latest-review.");
    process.exit(2);
  }
}
