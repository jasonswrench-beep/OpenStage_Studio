// Downloading the local voice (Kokoro-82M): every file pinned by size and SHA-256 in tools/kokoro-model.json, fetched
// with progress, carried on from where it stopped if it was interrupted, and stoppable at any time. A file that does not
// match its checksum is refused and removed. Nothing is sent but the requests for the files.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface VoiceFile {
  path: string;
  size: number;
  sha256: string;
  /** Where to fetch it, when it does not come from the manifest's source and revision (the AI runtime and licences). */
  url?: string;
}

export interface VoiceManifest {
  name: string;
  licence: string;
  source: string;
  revision: string;
  folder: string;
  defaultVoice?: string;
  files: VoiceFile[];
}

export interface Progress {
  done: number;
  total: number;
  file: string;
}

/** Where downloaded voices live: the user's local app data, one folder per pinned revision. */
export function voicesRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.LOCALAPPDATA ?? env.HOME ?? ".", "OpenStage Studio", "voices");
}

/** The address of one pinned file. */
export function fileUrl(m: VoiceManifest, f: VoiceFile): string {
  if (f.url) {
    if (!f.url.startsWith("https://")) throw new Error(`${f.path} is not on a secure address; it was not downloaded.`);
    return f.url;
  }
  return `${m.source}/resolve/${m.revision}/${f.path}`;
}

/** A manifest path must stay inside the voice folder. */
export function safePath(p: string): boolean {
  return /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/.test(p) && !p.split("/").includes("..");
}

export function sizeText(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export function progressText(p: Progress): string {
  const pct = p.total ? Math.floor((p.done / p.total) * 100) : 100;
  return `Downloading the voice: ${pct} percent (${sizeText(p.done)} of ${sizeText(p.total)}).`;
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Which files still need fetching, and how many bytes of each are already in a part-file from an earlier try. */
export function plan(dir: string, m: VoiceManifest): { file: VoiceFile; have: number; complete: boolean }[] {
  return m.files.map((file) => {
    const final = join(dir, file.path);
    if (existsSync(final) && statSync(final).size === file.size) return { file, have: file.size, complete: true };
    const part = `${final}.part`;
    const have = existsSync(part) ? Math.min(statSync(part).size, file.size) : 0;
    return { file, have, complete: false };
  });
}

export interface DownloadOptions {
  onProgress?: (p: Progress) => void;
  onNote?: (line: string) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Check the free room on the drive first (off in tests). */
  checkRoom?: boolean;
}

/** Download every file of the voice into `dir`. Resolves when all are there and match their checksums. */
export async function downloadVoice(m: VoiceManifest, dir: string, o: DownloadOptions = {}): Promise<void> {
  const note = o.onNote ?? (() => undefined);
  const doFetch = o.fetchImpl ?? fetch;
  for (const f of m.files) if (!safePath(f.path)) throw new Error(`The voice list names a file outside its folder (${f.path}); it was not used.`);
  mkdirSync(dir, { recursive: true });
  const steps = plan(dir, m);
  const total = m.files.reduce((n, f) => n + f.size, 0);
  let done = steps.reduce((n, s) => n + s.have, 0);
  const remaining = total - done;
  if (o.checkRoom !== false && remaining > 0) {
    const fsInfo = statfsSync(dir);
    const free = fsInfo.bavail * fsInfo.bsize;
    if (free < remaining + 100e6) throw new Error(`The voice needs ${sizeText(remaining)} more and the drive has ${sizeText(free)} free. Make some room, then try again.`);
  }
  for (const step of steps) {
    const { file } = step;
    const final = join(dir, file.path);
    if (step.complete) {
      if ((await sha256Of(final)) === file.sha256) continue;
      note(`${file.path} did not match its checksum and is downloaded again.`);
      rmSync(final);
      done -= file.size;
    }
    mkdirSync(dirname(final), { recursive: true });
    const part = `${final}.part`;
    let have = existsSync(part) ? statSync(part).size : 0;
    if (have > file.size) {
      rmSync(part);
      done -= have;
      have = 0;
    }
    if (have < file.size) {
      const res = await doFetch(fileUrl(m, file), { headers: have > 0 ? { Range: `bytes=${have}-` } : {}, signal: o.signal, redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`The download of ${file.path} was refused (${res.status}). Try again later.`);
      if (have > 0 && res.status !== 206) {
        // The server sent the whole file again: start this one over.
        done -= have;
        have = 0;
        rmSync(part, { force: true });
      }
      const out = createWriteStream(part, { flags: have > 0 ? "a" : "w" });
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
          done += chunk.length;
          o.onProgress?.({ done, total, file: file.path });
        }
      } finally {
        await new Promise<void>((r) => out.end(() => r()));
      }
    }
    const size = statSync(part).size;
    const sum = await sha256Of(part);
    if (size !== file.size || sum !== file.sha256) {
      rmSync(part, { force: true });
      throw new Error(`${file.path} did not match the checked copy (size or checksum), so it was removed. Try again; if it happens again, the file online has changed.`);
    }
    renameSync(part, final);
  }
  o.onProgress?.({ done: total, total, file: "" });
}

/** Whether every file is present at its right size (a quick check; the checksums were checked when downloaded). */
export function voiceReady(dir: string, m: VoiceManifest): boolean {
  return m.files.every((f) => existsSync(join(dir, f.path)) && statSync(join(dir, f.path)).size === f.size);
}
