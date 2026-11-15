// What several pages share: running a long job with its outcome on the page's result line, and choosing files.

import { open } from "@tauri-apps/plugin-dialog";
import { runJob } from "../engine.ts";
import { errorText, resultLine } from "../ui.ts";

export type Result = ReturnType<typeof resultLine>;

/** Run a long job; its failure (or cancelling) is said on the result line. Null if it did not finish. */
export async function act<T = Record<string, unknown>>(result: Result, label: string, job: string, args: Record<string, unknown> = {}, secret?: string): Promise<T | null> {
  result.set(`${label}...`);
  try {
    return await runJob<T>(label, job, args, secret);
  } catch (e) {
    result.set(errorText(e), "bad");
    return null;
  }
}

/** Choose one file. Null if the person closed the dialog. */
export async function chooseFile(title: string, name: string, extensions: string[]): Promise<string | null> {
  const p = await open({ multiple: false, title, filters: [{ name, extensions }] });
  return typeof p === "string" ? p : null;
}

export async function chooseFolder(title: string): Promise<string | null> {
  const p = await open({ directory: true, multiple: false, title });
  return typeof p === "string" ? p : null;
}

export const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
