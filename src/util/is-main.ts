// Whether a module is the program being run (`node src/x/y.ts`), so its command-line part should start.
//
// Installed Studio runs every job from one bundled file (src/engine/main.ts, bundled by tools/bundle-engine.mjs). There
// every module shares that one file's address, so each would think it was the program being run; the bundle sets
// __OPENSTAGE_BUNDLED__, and then only the engine's own command-line part starts.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

declare const __OPENSTAGE_BUNDLED__: boolean | undefined;

/** A path as it can be compared: without Windows' long-path prefix, and (on Windows) in one letter case. */
export function samePath(p: string): string {
  const plain = resolve(p.replace(/^\\\\\?\\/, ""));
  return process.platform === "win32" ? plain.toLowerCase() : plain;
}

export function isMain(moduleUrl: string, engine = false): boolean {
  if (typeof __OPENSTAGE_BUNDLED__ !== "undefined" && __OPENSTAGE_BUNDLED__ && !engine) return false;
  return !!process.argv[1] && samePath(process.argv[1]) === samePath(fileURLToPath(moduleUrl));
}
