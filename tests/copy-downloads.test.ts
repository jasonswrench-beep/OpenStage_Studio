import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyDownloads, privateCopies } from "../tools/copy-downloads.ts";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const voiceData = Buffer.from("an invented voice file");

/** A fake project root with tiny manifests, and a fake local AppData with one packaged app's private copy. */
function setup(damaged = false) {
  const base = mkdtempSync(join(tmpdir(), "studio-copy-"));
  const root = join(base, "root");
  mkdirSync(join(root, "tools"), { recursive: true });
  writeFileSync(join(root, "tools", "kokoro-model.json"), JSON.stringify({ name: "v", licence: "x", source: "https://x", revision: "r", folder: "voice-r", files: [{ path: "onnx/model.onnx", size: voiceData.length, sha256: sha(voiceData) }] }));
  writeFileSync(join(root, "tools", "local-ai.json"), JSON.stringify({ name: "m", licence: "x", source: "https://x", revision: "r", folder: "ai-r", model: "m.gguf", modelName: "M", runtime: { zip: "r.zip", keep: [] }, files: [{ path: "m.gguf", size: 4, sha256: sha(Buffer.from("abcd")) }] }));
  const local = join(base, "Local");
  const priv = join(local, "Packages", "Some.App_123", "LocalCache", "Local", "OpenStage Studio");
  mkdirSync(join(priv, "voices", "voice-r", "onnx"), { recursive: true });
  const stored = damaged ? Buffer.from("an invented voice filX") : voiceData;
  writeFileSync(join(priv, "voices", "voice-r", "onnx", "model.onnx"), stored);
  return { base, root, local };
}

test("the voice is copied from a packaged app's private copy and checked; the model with no copy is left alone", async () => {
  const { base, root, local } = setup();
  try {
    assert.equal(privateCopies(local).length, 1);
    const lines: string[] = [];
    assert.equal(await copyDownloads(local, (s) => lines.push(s), root), 1);
    assert.deepEqual(readFileSync(join(local, "org.openstage.studio", "voices", "voice-r", "onnx", "model.onnx")), voiceData, "copied into Studio's data folder, from a private copy under the old name");
    assert.ok(lines.some((l) => /The built-in AI model: no copy was found/.test(l)));
    assert.equal(await copyDownloads(local, () => undefined, root), 0, "a second run has nothing to do");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a copied file that does not match its fingerprint is removed, not used", async () => {
  const { base, root, local } = setup(true);
  try {
    await assert.rejects(copyDownloads(local, () => undefined, root), /did not match its checked copy/);
    assert.equal(existsSync(join(local, "org.openstage.studio", "voices", "voice-r", "onnx", "model.onnx")), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
