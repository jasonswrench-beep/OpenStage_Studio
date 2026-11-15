// Copies the narration voice and the built-in AI model from a packaged app's private copy of AppData to the real one.
//
// When an AI assistant runs Studio's commands from inside a packaged desktop app, Windows keeps what it downloads under
// AppData in that app's own folder (AppData\Local\Packages\<app>\LocalCache\Local\OpenStage Studio), where Studio, run
// normally, does not look. This finds such copies and copies the pinned files across, checking every one against its
// SHA-256 in tools/kokoro-model.json and tools/local-ai.json, so nothing unchecked is used. Nothing is downloaded and
// nothing is deleted.
//
// node tools/copy-downloads.ts   (Copy Downloads.bat)

import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sizeText, voiceReady, type VoiceManifest } from "../src/narration/voice-download.ts";
import { localAiReady, unpackRuntime, type LocalAiManifest } from "../src/ai/local.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Item {
  name: string;
  manifest: VoiceManifest;
  /** Where it lives under "OpenStage Studio" in local AppData. */
  under: string;
  ready(dir: string): boolean;
  after?(dir: string): void;
}

export function items(root = ROOT): Item[] {
  const voice = JSON.parse(readFileSync(join(root, "tools", "kokoro-model.json"), "utf8")) as VoiceManifest;
  const ai = JSON.parse(readFileSync(join(root, "tools", "local-ai.json"), "utf8")) as LocalAiManifest;
  return [
    { name: "The narration voice", manifest: voice, under: join("voices", voice.folder), ready: (d) => voiceReady(d, voice) },
    { name: "The built-in AI model", manifest: ai, under: join("ai", ai.folder), ready: (d) => localAiReady(ai, d), after: (d) => void unpackRuntime(ai, d) },
  ];
}

/** Packaged apps' private copies of "OpenStage Studio" in local AppData. */
export function privateCopies(local: string): string[] {
  const packages = join(local, "Packages");
  if (!existsSync(packages)) return [];
  return readdirSync(packages, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(packages, d.name, "LocalCache", "Local", "OpenStage Studio"))
    .filter((p) => existsSync(p));
}

async function sha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

export async function copyDownloads(local: string, log: (s: string) => void = console.log, root = ROOT): Promise<number> {
  const copies = privateCopies(local);
  let copied = 0;
  for (const it of items(root)) {
    const dest = join(local, "OpenStage Studio", it.under);
    // Ready means the files are there and, for the model, unpacked.
    const voiceOnly = (d: string) => voiceReady(d, it.manifest);
    if (it.ready(dest)) {
      log(`${it.name} is already where Studio looks (${dest}).`);
      continue;
    }
    const source = copies.map((c) => join(c, it.under)).find(voiceOnly);
    if (!source) {
      log(`${it.name}: no copy was found to copy from. Studio will offer to download it when it is needed.`);
      continue;
    }
    const total = it.manifest.files.reduce((n, f) => n + f.size, 0);
    log(`${it.name}: copying ${sizeText(total)} from ${source}`);
    for (const f of it.manifest.files) {
      const to = join(dest, f.path);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(join(source, f.path), to);
      if ((await sha256(to)) !== f.sha256) {
        rmSync(to, { force: true });
        throw new Error(`${f.path} did not match its checked copy, so it was removed. Nothing else was changed; Studio will download it when needed.`);
      }
      log(`  ${f.path}: copied and checked.`);
    }
    it.after?.(dest);
    copied++;
    log(`${it.name} is ready.`);
  }
  return copied;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const local = process.env.LOCALAPPDATA;
  if (!local) {
    console.error("This computer has no local AppData folder to copy into.");
    process.exit(1);
  }
  copyDownloads(local).then(
    (n) => console.log(n ? `\nDone: ${n} item(s) copied and checked.` : "\nNothing needed copying."),
    (e) => {
      console.error(`\nThe copy did not finish: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
