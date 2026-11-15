// The built-in AI model: Qwen 3.5 (4 billion parameters), run on this computer by llama.cpp's server. Downloaded once,
// on request, from the pinned list in tools/local-ai.json, every file checked against its SHA-256 (the same pins the
// documentation tool uses). The server is started only while Studio needs it, listens on this computer only, and is
// stopped afterward. Nothing leaves the computer.

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { availableParallelism } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import { downloadVoice, voiceReady, type DownloadOptions, type VoiceManifest } from "../narration/voice-download.ts";
import { appRoot, downloadsRoot } from "../paths.ts";
import { matches, readZip, safeName } from "../util/zip.ts";

export interface LocalAiManifest extends VoiceManifest {
  model: string;
  modelName: string;
  runtime: { zip: string; keep: string[] };
}

export function readLocalManifest(root = appRoot()): LocalAiManifest {
  return JSON.parse(readFileSync(join(root, "tools", "local-ai.json"), "utf8")) as LocalAiManifest;
}

/** Where the built-in model lives: Studio's data folder in local AppData, one folder per pinned version. */
export function localAiFolder(m: LocalAiManifest, env: NodeJS.ProcessEnv = process.env): string {
  return join(downloadsRoot(env), "ai", m.folder);
}

const runtimeFolder = (dir: string) => join(dir, "runtime");

/** Whether the model and its runtime are downloaded and unpacked. */
export function localAiReady(m: LocalAiManifest, dir = localAiFolder(m)): boolean {
  return voiceReady(dir, m) && existsSync(join(runtimeFolder(dir), "llama-server.exe"));
}

/** Download everything (or carry on from where it stopped), then unpack the runtime's files from its zip. */
export async function downloadLocalAi(m: LocalAiManifest, o: DownloadOptions = {}, dir = localAiFolder(m)): Promise<void> {
  await downloadVoice(m, dir, o);
  unpackRuntime(m, dir);
}

/** Unpack only the runtime files the pinned list keeps, flat into the runtime folder. */
export function unpackRuntime(m: LocalAiManifest, dir: string): string[] {
  const out = runtimeFolder(dir);
  mkdirSync(out, { recursive: true });
  const kept: string[] = [];
  for (const e of readZip(readFileSync(join(dir, m.runtime.zip)))) {
    if (!safeName(e.name)) continue;
    const name = basename(e.name);
    if (!m.runtime.keep.some((k) => matches(name, k))) continue;
    writeFileSync(join(out, name), e.read());
    kept.push(name);
  }
  if (!kept.includes("llama-server.exe")) throw new Error("The runtime's zip did not hold llama-server.exe.");
  return kept;
}

/** A free port on this computer. */
async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });
}

export interface LocalServer {
  /** The chat-completions address, on this computer. */
  address: string;
  model: string;
  /** The server's one-time password. */
  key: string;
  stop(): Promise<void>;
}

/** Start the model's server and wait until it answers. The server is told to stay on this computer. */
export async function startLocalAi(m: LocalAiManifest, o: { log?: (s: string) => void; contextTokens?: number } = {}, dir = localAiFolder(m)): Promise<LocalServer> {
  if (!localAiReady(m, dir)) throw new Error("The built-in AI model is not downloaded yet. Run \"Set Up AI.bat\" and choose the built-in model.");
  const port = await freePort();
  const exe = join(runtimeFolder(dir), "llama-server.exe");
  // A one-time password, given through the environment (never on the command line, which other programs can read), so
  // no other program on this computer can use the server while it runs.
  const key = randomBytes(24).toString("hex");
  // The same options as the documentation tool: this computer only, no web page, no slot list, no thinking, one request
  // at a time.
  const child: ChildProcess = spawn(exe, [
    "--model", join(dir, m.model),
    "--host", "127.0.0.1", "--port", String(port),
    "--ctx-size", String(Math.min(32768, Math.max(1024, o.contextTokens ?? 16384))),
    "--threads", String(Math.min(64, Math.max(1, availableParallelism() - 1))),
    "--parallel", "1",
    "--no-webui", "--no-slots",
    "--reasoning", "off",
    "--cache-ram", "256",
    "--timeout", "600",
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, env: { ...process.env, LLAMA_API_KEY: key } });
  let err = "";
  child.stderr?.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-4000)));
  const base = `http://127.0.0.1:${port}`;
  o.log?.("Starting the built-in AI model (this takes a moment the first time).");
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`The built-in AI model stopped as it started: ${err.trim().split("\n").slice(-3).join(" ")}`);
    try {
      const r = await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${key}` } });
      if (r.ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() - started > 180000) {
      child.kill();
      throw new Error("The built-in AI model did not start within three minutes.");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    address: `${base}/v1`,
    model: m.modelName,
    key,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill();
        await new Promise((r) => setTimeout(r, 300));
      }
    },
  };
}
