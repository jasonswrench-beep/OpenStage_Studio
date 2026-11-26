// Steps in another program's window (a script step's `window`, format version 4), and the other programs a take opens beside the
// program (ProgramEntry.companions). The other window's controls are found and worked through Windows' accessibility interface
// (studio-helper's `uia` command, the same hands the accessibility driver uses), never with the real mouse or keyboard: the pointer
// the viewer follows is drawn on afterward, as for every step.

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { helperPath } from "./helper.ts";
import type { ProgramEntry } from "./programs.ts";
import type { Step } from "../script/format.ts";

/** How a control of another window is found: by automation id, or by role and name. */
export interface OutsideKey {
  id?: string;
  role?: string;
  name?: string;
}

/** A control of another window, as Windows' accessibility interface reports it. `rect` and `display` are on the whole desktop, in
 * screen pixels; `display` is the display that window is on. */
export interface OutsideControl {
  window: string;
  id: string;
  name: string;
  role: string;
  rect: [number, number, number, number];
  visible: boolean;
  enabled: boolean;
  display: [number, number, number, number] | null;
}

/** What the player needs for a step in another window. */
export interface Outside {
  locate(window: string, key: OutsideKey): Promise<OutsideControl>;
  press(window: string, key: OutsideKey, action: "invoke" | "append" | "choose", value?: string): Promise<void>;
}

/** The control a step in another window names. */
export function outsideKey(step: Step): OutsideKey {
  if (step.target) return { id: step.target };
  return { ...(step.fallback?.role ? { role: step.fallback.role } : {}), ...(step.fallback?.name ? { name: step.fallback.name } : {}) };
}

/** Words for a control of another window, for messages. */
export function describeKey(key: OutsideKey): string {
  return key.id ? `"${key.id}"` : `the ${key.role ?? "control"} called "${key.name ?? ""}"`;
}

/** The helper's `uia` command, started when first needed. */
export class OutsideHands implements Outside {
  private helper: ChildProcess | null = null;
  private waiting: ((v: { ok: boolean; result?: unknown; error?: string }) => void)[] = [];
  private starting: Promise<void> | null = null;
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  private start(): Promise<void> {
    this.starting ??= (async () => {
      const h = spawn(helperPath(this.root), ["uia"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
      this.helper = h;
      const lines = createInterface({ input: h.stdout! });
      await new Promise<void>((ok, fail) => {
        h.once("error", fail);
        lines.once("line", () => ok());
      });
      lines.on("line", (l) => {
        try {
          this.waiting.shift()?.(JSON.parse(l));
        } catch {
          // Not a reply.
        }
      });
    })();
    return this.starting;
  }

  private async ask<T>(command: Record<string, unknown>): Promise<T> {
    await this.start();
    return new Promise((ok, fail) => {
      this.waiting.push((v) => (v.ok ? ok(v.result as T) : fail(new Error(v.error ?? "Windows' accessibility interface could not do that."))));
      this.helper!.stdin!.write(JSON.stringify(command) + "\n");
    });
  }

  async locate(window: string, key: OutsideKey): Promise<OutsideControl> {
    const c = await this.ask<OutsideControl & { rect: number[] }>({ cmd: "locate", window, key });
    return { ...c, rect: c.rect as [number, number, number, number] };
  }

  async press(window: string, key: OutsideKey, action: "invoke" | "append" | "choose", value?: string): Promise<void> {
    await this.ask({ cmd: "press", window, key, action, ...(value !== undefined ? { value } : {}) });
  }

  /** Wait until a window whose title has `title` in it is open, at most `ms`. */
  async waitForWindow(title: string, ms = 40000): Promise<void> {
    const end = Date.now() + ms;
    for (;;) {
      try {
        await this.ask({ cmd: "attach", window: title });
        return;
      } catch (e) {
        if (Date.now() > end) throw new Error(`The window "${title}" did not open within ${Math.round(ms / 1000)} seconds (${e instanceof Error ? e.message : String(e)}).`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  async close(): Promise<void> {
    this.helper?.stdin?.end();
    await new Promise((r) => setTimeout(r, 100));
    this.helper?.kill();
  }
}

/** Opens the other programs a take or a rehearsal needs beside the program (OpenStage Capture's Tea Timer), each on the take display,
 * and waits for each one's window. `close` ends them. */
export async function openCompanions(program: ProgramEntry, root: string, monitor: number, log: (s: string) => void, hands: OutsideHands): Promise<{ close(): void }> {
  const started: ChildProcess[] = [];
  const close = () => {
    for (const c of started) c.kill();
  };
  try {
    for (const c of program.companions?.(root, monitor) ?? []) {
      log(`Opening ${c.name} beside ${program.name}.`);
      started.push(spawn(c.exe, c.args, { stdio: "ignore", windowsHide: false }));
      await hands.waitForWindow(c.windowTitle);
    }
  } catch (e) {
    close();
    throw e;
  }
  return { close };
}
