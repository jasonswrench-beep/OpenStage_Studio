import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadVoice, plan, progressText, safePath, voiceReady, type VoiceManifest } from "../src/narration/voice-download.ts";

const body = Buffer.from("x".repeat(5000) + "y".repeat(5000));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** A stand-in for the model's host that serves one file and honours Range requests, counting what it sent. */
async function host() {
  let sent = 0;
  let ranged = 0;
  const server = createServer((req, res) => {
    const range = /bytes=(\d+)-/.exec(req.headers.range ?? "");
    const from = range ? Number(range[1]) : 0;
    if (range) ranged++;
    const part = body.subarray(from);
    sent += part.length;
    res.writeHead(range ? 206 : 200, { "Content-Length": part.length });
    res.end(part);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const manifest: VoiceManifest = {
    name: "Test voice", licence: "Apache-2.0", source: `http://127.0.0.1:${port}/model`, revision: "abc", folder: "test",
    defaultVoice: "v", files: [{ path: "onnx/model.onnx", size: body.length, sha256: sha(body) }],
  };
  return { manifest, stats: () => ({ sent, ranged }), close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("the voice downloads, is checked, and is ready", async () => {
  const h = await host();
  const dir = mkdtempSync(join(tmpdir(), "voice-"));
  try {
    const seen: number[] = [];
    await downloadVoice(h.manifest, dir, { checkRoom: false, onProgress: (p) => seen.push(p.done) });
    assert.deepEqual(readFileSync(join(dir, "onnx/model.onnx")), body);
    assert.equal(voiceReady(dir, h.manifest), true);
    assert.equal(seen[seen.length - 1], body.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await h.close();
  }
});

test("an interrupted download carries on from where it stopped", async () => {
  const h = await host();
  const dir = mkdtempSync(join(tmpdir(), "voice-"));
  try {
    mkdirSync(join(dir, "onnx"), { recursive: true });
    writeFileSync(join(dir, "onnx/model.onnx.part"), body.subarray(0, 4000));
    assert.equal(plan(dir, h.manifest)[0].have, 4000);
    await downloadVoice(h.manifest, dir, { checkRoom: false });
    assert.deepEqual(readFileSync(join(dir, "onnx/model.onnx")), body);
    assert.equal(h.stats().ranged, 1, "it asked only for the rest");
    assert.equal(h.stats().sent, body.length - 4000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await h.close();
  }
});

test("a file that does not match its checksum is refused and removed", async () => {
  const h = await host();
  const dir = mkdtempSync(join(tmpdir(), "voice-"));
  try {
    const wrong = { ...h.manifest, files: [{ ...h.manifest.files[0], sha256: "0".repeat(64) }] };
    await assert.rejects(downloadVoice(wrong, dir, { checkRoom: false }), /did not match the checked copy/);
    assert.equal(existsSync(join(dir, "onnx/model.onnx")), false);
    assert.equal(existsSync(join(dir, "onnx/model.onnx.part")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await h.close();
  }
});

test("stopping keeps what was downloaded", async () => {
  const h = await host();
  const dir = mkdtempSync(join(tmpdir(), "voice-"));
  try {
    const stop = new AbortController();
    stop.abort();
    await assert.rejects(downloadVoice(h.manifest, dir, { checkRoom: false, signal: stop.signal }));
    assert.equal(existsSync(join(dir, "onnx/model.onnx")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await h.close();
  }
});

test("the pinned list in the repository is well formed and stays inside its folder", () => {
  const m = JSON.parse(readFileSync("tools/kokoro-model.json", "utf8")) as VoiceManifest;
  assert.equal(m.licence, "Apache-2.0");
  assert.match(m.revision, /^[0-9a-f]{40}$/);
  for (const f of m.files) {
    assert.ok(safePath(f.path), f.path);
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
  }
  assert.ok(m.files.some((f) => f.path === `voices/${m.defaultVoice}.bin`));
  assert.equal(safePath("../outside"), false);
  assert.equal(progressText({ done: 170e6, total: 340e6, file: "" }), "Downloading the voice: 50 percent (170 MB of 340 MB).");
});
