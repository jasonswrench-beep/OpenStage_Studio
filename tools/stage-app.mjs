// Lays out Studio's own files the way the installer puts them in the install folder (the resources in
// src-tauri/tauri.conf.json and src-tauri/tauri.installer.json), in a folder of its own. The engine check runs the bundled
// engine from such a folder, so it sees exactly what an installed Studio sees, without installing anything.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TAURI = join(ROOT, "src-tauri");

/** Every resource the installer carries: its source (in the repository) and where it goes in the install folder. */
export function resourceMap() {
  const read = (f) => JSON.parse(readFileSync(join(TAURI, f), "utf8")).bundle.resources;
  return Object.entries({ ...read("tauri.conf.json"), ...read("tauri.installer.json") }).map(([from, to]) => ({ from: resolve(TAURI, from), to }));
}

/** Copy them into `dest` (emptied first), leaving out any named in `skip` (by their place in the install folder). */
export function stageApp(dest, { skip = [] } = {}) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const missing = [];
  for (const { from, to } of resourceMap()) {
    if (skip.some((s) => to.startsWith(s))) continue;
    if (!existsSync(from)) {
      missing.push(from);
      continue;
    }
    const target = join(dest, to);
    mkdirSync(statSync(from).isDirectory() ? target : dirname(target), { recursive: true });
    cpSync(from, target, { recursive: true });
  }
  return { dest, missing };
}
