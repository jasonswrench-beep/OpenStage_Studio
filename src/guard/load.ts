// Reading blocklists from files, on this computer (Node only; the app reads them through its own file access).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, homedir, userInfo } from "node:os";
import { join, relative } from "node:path";
import { makeBlocklist, starterBlocklistFile, type Blocklist, type BlocklistFile } from "./blocklist.ts";

/** The person's own blocklist, beside the project. Git ignores it, so names written there never reach the repository. */
export const LOCAL_BLOCKLIST = "blocklist.local.json";

export interface LoadedBlocklist {
  list: Blocklist;
  /** The files that were read, for the guard report. */
  files: string[];
  problems: string[];
}

/** This computer's user name, home folder and name. */
export function computerFacts() {
  let userName: string | undefined;
  try {
    userName = userInfo().username;
  } catch {
    userName = process.env.USERNAME;
  }
  return { userName, homeFolder: homedir(), computerName: hostname() };
}

/** The blocklist for a run: the person's own file (if there is one) and any others named, plus this computer's facts. */
export function loadBlocklist(root: string, extra: string[] = []): LoadedBlocklist {
  const paths = [join(root, LOCAL_BLOCKLIST), ...extra].filter((p, i, all) => all.indexOf(p) === i);
  const files: BlocklistFile[] = [];
  const used: string[] = [];
  const problems: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) {
      if (extra.includes(p)) problems.push(`The blocklist ${p} does not exist.`);
      continue;
    }
    try {
      files.push(JSON.parse(readFileSync(p, "utf8")) as BlocklistFile);
      used.push(relative(root, p) || p);
    } catch (e) {
      problems.push(`The blocklist ${p} could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const made = makeBlocklist(files, computerFacts());
  return { list: made.list, files: used, problems: [...problems, ...made.problems] };
}

/** Start the person's own blocklist if they have none. Returns its path, and whether it was made just now. */
export function ensureLocalBlocklist(root: string): { path: string; made: boolean } {
  const path = join(root, LOCAL_BLOCKLIST);
  if (existsSync(path)) return { path, made: false };
  writeFileSync(path, starterBlocklistFile());
  return { path, made: true };
}
