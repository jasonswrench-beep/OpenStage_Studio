// Starting the engine's jobs from the window (src-tauri/src/engine.rs runs them; src/engine/main.ts is the engine).
//
// One long job runs at a time (making a video takes the take screen; the others are downloads, planning and batch runs).
// Its progress is shown in the job area on every page (src/app/job-area.ts), so a person can move between pages while it
// runs. Quick questions (Studio's state, the lists of scripts and videos) are asked with `ask`, beside it, silently.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface EngineEvent {
  run: number;
  type: "log" | "result" | "failed" | "ended";
  text?: string;
  value?: unknown;
  message?: string;
  code?: number | null;
}

type Listener = (e: { kind: "start" | "log" | "end"; label: string; text?: string; ok?: boolean; cancelled?: boolean }) => void;

const listeners = new Set<Listener>();
const handlers = new Map<number, (e: EngineEvent) => void>();
/** Events for a run the window does not know the number of yet (a quick job can finish before its number arrives). */
const early = new Map<number, EngineEvent[]>();
let listening: Promise<unknown> | null = null;
let current: { label: string; run: number; cancelled: boolean } | null = null;

function ensureListening() {
  listening ??= listen<EngineEvent>("engine", (e) => {
    const h = handlers.get(e.payload.run);
    if (h) h(e.payload);
    else early.set(e.payload.run, [...(early.get(e.payload.run) ?? []), e.payload]);
  });
  return listening;
}

/** Start a job; `onEvent` gets every event of it, including any that came before its number did. */
async function start(job: string, args: Record<string, unknown>, secret: string | undefined, onEvent: (e: EngineEvent) => void): Promise<number> {
  await ensureListening();
  const run = await invoke<number>("run_engine", { job, args, secret: secret ?? null });
  handlers.set(run, (e) => {
    if (e.type === "ended") handlers.delete(run);
    onEvent(e);
  });
  for (const e of early.get(run) ?? []) handlers.get(run)?.(e);
  early.delete(run);
  return run;
}

/** Follow the long job's progress (the job area does). */
export function onJob(l: Listener): void {
  listeners.add(l);
}

const tell = (e: Parameters<Listener>[0]) => listeners.forEach((l) => l(e));

export const busy = () => current?.label ?? null;

export class Busy extends Error {}
export class Cancelled extends Error {}

/** Ask a quick question of the engine (no progress shown, and it can run beside a long job). */
export function ask<T>(job: string, args: Record<string, unknown> = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let result: unknown;
    let failure: string | undefined;
    let said: string | undefined;
    start(job, args, undefined, (e) => {
      if (e.type === "log") said = e.text;
      else if (e.type === "result") result = e.value;
      else if (e.type === "failed") failure = e.message;
      else if (e.type === "ended") (failure || result === undefined ? reject(new Error(failure ?? `the engine's ${job} job stopped without an answer${said ? ` (its last words: ${said})` : ""}.`)) : resolve(result as T));
    }).catch((e) => reject(new Error(String(e))));
  });
}

/**
 * Run a long job and wait for its result. `label` names it for people ("Making the video"). A key, if any, goes to the
 * engine's standard input, never its command line. Rejects with Busy if another long job is running, Cancelled if it was
 * stopped, or an Error with the engine's own words.
 */
export function runJob<T = Record<string, unknown>>(label: string, job: string, args: Record<string, unknown> = {}, secret?: string): Promise<T> {
  if (current) return Promise.reject(new Busy(`Another job is running: ${current.label}. Wait for it to finish, or cancel it in the job area.`));
  const me = { label, run: 0, cancelled: false };
  current = me;
  tell({ kind: "start", label });
  return new Promise<T>((resolve, reject) => {
    let result: unknown;
    let failure: string | undefined;
    const end = (ok: boolean, text?: string) => {
      current = null;
      tell({ kind: "end", label, ok, cancelled: me.cancelled, text });
    };
    start(job, args, secret, (e) => {
      if (e.type === "log" && e.text) tell({ kind: "log", label, text: e.text });
      else if (e.type === "result") result = e.value;
      else if (e.type === "failed") failure = e.message;
      else if (e.type === "ended") {
        if (me.cancelled) {
          end(false, "Cancelled.");
          reject(new Cancelled(`${label}: cancelled. Anything already downloaded is kept.`));
        } else if (failure || result === undefined) {
          const why = failure ?? `It stopped without finishing (code ${e.code ?? "unknown"}).`;
          end(false, why);
          reject(new Error(why));
        } else {
          end(true);
          resolve(result as T);
        }
      }
    }).then(
      (run) => (me.run = run),
      (e) => {
        end(false, String(e));
        reject(new Error(String(e)));
      },
    );
  });
}

/** Cancel the long job, if one is running. */
export async function cancelJob(): Promise<boolean> {
  if (!current || !current.run) return false;
  current.cancelled = true;
  return invoke<boolean>("cancel_engine", { run: current.run });
}

/** Let the window read and write the person's work folder; returns its path. */
export const allowWorkspace = () => invoke<string>("allow_workspace");
