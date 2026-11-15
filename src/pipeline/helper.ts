// Running studio-helper (the native part, in Rust) and reading what it says, one JSON object a line.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

export type HelperEvent = { event: string; [key: string]: unknown };

export function helperPath(root: string): string {
  const path = resolve(root, "studio-helper/target/release/studio-helper.exe");
  if (!existsSync(path)) throw new Error(`The helper is not built yet (${path}). Run "Build Studio.bat" first.`);
  return path;
}

/** Run the helper once and collect what it says. Rejects with the helper's own words if it fails. */
export function runHelper(exe: string, args: string[], onEvent?: (e: HelperEvent) => void): Promise<HelperEvent[]> {
  return new Promise((done, fail) => {
    const child = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const events: HelperEvent[] = [];
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      try {
        const e = JSON.parse(line) as HelperEvent;
        events.push(e);
        onEvent?.(e);
      } catch {
        // Not a message: ignore.
      }
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (code === 0) return done(events);
      const said = events.find((e) => e.event === "error")?.message as string | undefined;
      fail(new Error(said ?? (stderr.trim() || `The helper stopped with code ${code}.`)));
    });
  });
}

/** A take in progress: the helper watching one window, saving a still picture whenever asked. */
export class TakeSession {
  private child: ChildProcessWithoutNullStreams;
  private waiters: ((e: HelperEvent) => void)[] = [];
  private stderr = "";
  private ended: Error | null = null;

  constructor(exe: string, window: string, size: [number, number]) {
    this.child = spawn(exe, ["take", "--window", window, "--width", String(size[0]), "--height", String(size[1])], { windowsHide: true });
    this.child.stderr.on("data", (d: Buffer) => (this.stderr += d.toString()));
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      let e: HelperEvent;
      try {
        e = JSON.parse(line) as HelperEvent;
      } catch {
        return;
      }
      this.waiters.shift()?.(e);
    });
    this.child.on("close", (code) => {
      this.ended = new Error(this.stderr.trim() || `The helper stopped (code ${code}).`);
      for (const w of this.waiters.splice(0)) w({ event: "error", message: this.ended.message });
    });
  }

  private next(timeoutMs: number): Promise<HelperEvent> {
    if (this.ended) return Promise.reject(this.ended);
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error("The helper did not answer in time.")), timeoutMs);
      this.waiters.push((e) => {
        clearTimeout(timer);
        if (e.event === "error") fail(new Error(String(e.message)));
        else done(e);
      });
    });
  }

  async ready(): Promise<HelperEvent> {
    return this.next(40000);
  }

  /** Save a still picture once the window has stopped changing. Returns the file and its fingerprint. */
  async grab(dir: string, settleMs = 180): Promise<{ file: string; hash: string; settled: boolean }> {
    const answer = this.next(15000);
    this.child.stdin.write(JSON.stringify({ cmd: "grab", dir, settleMs, timeoutMs: 6000 }) + "\n");
    const e = await answer;
    return { file: String(e.file), hash: String(e.hash), settled: e.settled !== false };
  }

  async stop(): Promise<void> {
    if (this.ended) return;
    const answer = this.next(5000).catch(() => undefined);
    this.child.stdin.write(JSON.stringify({ cmd: "stop" }) + "\n");
    await answer;
    this.child.stdin.end();
    // If it has not ended a moment later, end it: every picture is already saved.
    await new Promise<void>((done) => {
      if (this.ended) return done();
      const timer = setTimeout(() => {
        this.child.kill();
        done();
      }, 2000);
      this.child.once("close", () => {
        clearTimeout(timer);
        done();
      });
    });
  }

  kill() {
    this.child.kill();
  }
}

/** How long a 16-bit PCM WAV file's sound lasts, in milliseconds (read from its header). */
export function wavDurationMs(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let pos = 12;
  let rate = 0;
  let blockAlign = 0;
  while (pos + 8 <= bytes.length) {
    const id = tag(pos);
    const size = view.getUint32(pos + 4, true);
    if (id === "fmt ") {
      rate = view.getUint32(pos + 12, true);
      blockAlign = view.getUint16(pos + 20, true);
    } else if (id === "data") {
      if (!rate || !blockAlign) throw new Error("the WAV file has no format before its data");
      const frames = Math.floor(Math.min(size, bytes.length - pos - 8) / blockAlign);
      return Math.floor((frames * 1000) / rate);
    }
    pos += 8 + size + (size & 1);
  }
  throw new Error("the WAV file has no sound data");
}
