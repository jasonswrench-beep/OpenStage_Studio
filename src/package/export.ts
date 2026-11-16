// Exports publishing packages: one folder per approved video, numbered in playlist order, plus a checklist of what to
// upload where. A video is exported only if its review is open: every flag resolved, a person's approval, and the video
// file still the very one that was reviewed. Anything else is refused and says why.
//
// node src/package/export.ts [<render folder>...] [--out <folder>]
// With no folders named, every reviewed video in renders\ is considered. The app's Export button does the same for one
// video (src/review/view.ts), with the same files.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { gate, guardReport, type Review } from "../guard/review.ts";
import { checklistText, uploadText, type PublishDraft, type VideoRecord } from "./package.ts";
import { workspace } from "../paths.ts";
import { isMain } from "../util/is-main.ts";

/** Where a person's work is: the project folder in the repository, or the workspace when installed (src/paths.ts). */
const ROOT = workspace();

/** The files copied from a video's folder into its package, as they are named there. */
export const PACKAGE_COPIES = ["captions.srt", "captions.vtt", "transcript.txt", "thumbnail.png"] as const;
/** Copied when the video has them: the description track (made since 2026-11-15; older videos have none). */
export const PACKAGE_EXTRAS = ["descriptions.vtt"] as const;

export interface Exported {
  folder: string;
  record: VideoRecord;
}

const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Why a render folder cannot be exported, or null if it can. */
export function refusal(renderFolder: string): string | null {
  const reviewFile = join(renderFolder, "review.json");
  if (!existsSync(reviewFile)) return "It has no review yet. Make the video again so the frame scan runs.";
  const review = JSON.parse(readFileSync(reviewFile, "utf8")) as Review;
  const g = gate(review);
  if (!g.open) return g.says;
  const video = join(renderFolder, review.video);
  if (!existsSync(video)) return `The video ${review.video} is missing.`;
  if (digest(video) !== review.videoDigest) return "The video has changed since it was reviewed. Review it again.";
  for (const f of [...PACKAGE_COPIES, "publish.json"]) if (!existsSync(join(renderFolder, f))) return `${f} is missing. Make the video again.`;
  return null;
}

/** Export one reviewed and approved video into its own folder under `outRoot`. */
export function exportOne(renderFolder: string, outRoot: string): Exported {
  const why = refusal(renderFolder);
  if (why) throw new Error(`${basename(renderFolder)} was not exported. ${why}`);
  const review = JSON.parse(readFileSync(join(renderFolder, "review.json"), "utf8")) as Review;
  const { folderName, ...draft } = JSON.parse(readFileSync(join(renderFolder, "publish.json"), "utf8")) as PublishDraft;
  const record: VideoRecord = { ...draft, approvedBy: review.approval!.by };
  const folder = join(outRoot, folderName);
  mkdirSync(folder, { recursive: true });
  copyFileSync(join(renderFolder, review.video), join(folder, "video.mp4"));
  for (const f of PACKAGE_COPIES) copyFileSync(join(renderFolder, f), join(folder, f));
  for (const f of PACKAGE_EXTRAS) if (existsSync(join(renderFolder, f))) copyFileSync(join(renderFolder, f), join(folder, f));
  writeFileSync(join(folder, "upload.txt"), uploadText(record));
  writeFileSync(join(folder, "video.json"), JSON.stringify(record, null, 2) + "\n");
  // The guard report stays with the project, beside the video; it is brought up to date here, never put in the package.
  writeFileSync(join(renderFolder, "guard-report.txt"), guardReport(review));
  return { folder, record };
}

/** The checklist for every package in a folder (read from each one's video.json), in playlist order. */
export function writeChecklist(outRoot: string): string | null {
  const entries = readdirSync(outRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(outRoot, d.name, "video.json")))
    .map((d) => ({ folder: d.name, record: JSON.parse(readFileSync(join(outRoot, d.name, "video.json"), "utf8")) as VideoRecord }));
  if (!entries.length) return null;
  const file = join(outRoot, "checklist.txt");
  writeFileSync(file, checklistText(entries));
  return file;
}

/** Export every approved video among the folders, and write the checklist. Folders that cannot go are listed with why. */
export function exportAll(renderFolders: string[], outRoot: string, log: (s: string) => void = console.log): { exported: Exported[]; refused: { folder: string; why: string }[] } {
  const exported: Exported[] = [];
  const refused: { folder: string; why: string }[] = [];
  for (const f of renderFolders) {
    const why = refusal(f);
    if (why) {
      refused.push({ folder: f, why });
      log(`Not exported: ${basename(f)}. ${why}`);
      continue;
    }
    const e = exportOne(f, outRoot);
    exported.push(e);
    log(`Exported: ${basename(f)} to ${e.folder}`);
  }
  if (exported.length) {
    const file = writeChecklist(outRoot);
    if (file) log(`The upload checklist is in ${file}`);
  }
  return { exported, refused };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--out");
  const out = resolve(at >= 0 ? args[at + 1] : join(ROOT, "packages"));
  let folders = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out").map((a) => resolve(a));
  if (!folders.length) {
    const renders = join(ROOT, "renders");
    folders = existsSync(renders)
      ? readdirSync(renders, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(renders, d.name, "review.json"))).map((d) => join(renders, d.name))
      : [];
  }
  if (!folders.length) {
    console.log("There are no reviewed videos to export. Make a video first, then review it.");
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  const { exported } = exportAll(folders, out);
  process.exit(exported.length ? 0 : 1);
}
