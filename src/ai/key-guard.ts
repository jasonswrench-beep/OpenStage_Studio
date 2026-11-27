// Keeping a person's AI key unreadable on disk: Windows encrypts it for the person signed in, through the helper's
// `protect` and `unprotect` (studio-helper/src/secret.rs). The key goes to the helper on its standard input, never on its
// command line.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { helperExe } from "../paths.ts";

export interface KeyGuard {
  /** The key, encrypted for this person on this computer. Throws, in words, if it cannot be. */
  protect(key: string): string;
  /** The key back again. Throws if it was protected for someone else or on another computer. */
  unprotect(kept: string): string;
}

function ask(command: "protect" | "unprotect", input: string): Record<string, unknown> {
  const exe = helperExe();
  if (!existsSync(exe)) throw new Error(`The helper is not built yet (${exe}). Run "Build Studio.bat" first.`);
  const done = spawnSync(exe, [command], { input, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  if (done.status !== 0) throw new Error(done.stderr?.trim() || "The helper could not do it.");
  return JSON.parse(done.stdout.trim()) as Record<string, unknown>;
}

export const windowsKeyGuard: KeyGuard = {
  protect: (key) => String(ask("protect", key).data),
  unprotect: (kept) => String(ask("unprotect", kept).text),
};
