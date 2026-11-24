// What the security review of 2026-11-17 asked to be proved. All names, keys and addresses here are invented.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { windowsKeyGuard, type KeyGuard } from "../src/ai/key-guard.ts";
import { missing, readAiSettings, safeAddress, writeAiSettings } from "../src/ai/settings.ts";
import { helperExe } from "../src/paths.ts";
import { onADrive } from "../src/review/script-path.ts";
import { readZip } from "../src/util/zip.ts";

const ROOT = resolve(import.meta.dirname, "..");
const text = (file: string) => readFileSync(join(ROOT, file), "utf8");

function inFolder(run: (file: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "studio-security-"));
  try {
    run(join(dir, "ai.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A stand-in that hides a key plainly enough to see that it was used. */
const standIn: KeyGuard = {
  protect: (key) => Buffer.from(key).toString("hex"),
  unprotect: (kept) => Buffer.from(kept, "hex").toString(),
};
const broken: KeyGuard = {
  protect: () => {
    throw new Error("no helper");
  },
  unprotect: () => {
    throw new Error("someone else's");
  },
};

test("a service's address must be https, or http on this computer", () => {
  for (const ok of ["https://ai.example/v1", "http://127.0.0.1:8080/v1", "http://localhost:1234", "http://[::1]:9/v1"]) assert.ok(safeAddress(ok), ok);
  for (const bad of ["http://ai.example/v1", "http://127.0.0.1.ai.example", "http://localhost@ai.example", "http://192.168.1.5:8080", "ftp://ai.example", "ai.example", "", undefined]) assert.equal(safeAddress(bad), false, String(bad));
  assert.match(missing({ choice: "hosted", preset: "custom", address: "http://ai.example/v1", model: "m" }) ?? "", /https:\/\//);
  assert.equal(missing({ choice: "hosted", preset: "custom", address: "https://ai.example/v1", model: "m" }), null);
  assert.equal(missing({ choice: "hosted", preset: "custom", address: "http://127.0.0.1:8080/v1", model: "m" }), null);
});

test("a key is never kept in clear, and comes back when the settings are read", () => inFolder((file) => {
  writeAiSettings({ choice: "hosted", preset: "custom", model: "m", key: "invented-key-123" }, file, standIn);
  assert.doesNotMatch(readFileSync(file, "utf8"), /invented-key-123/);
  assert.equal(existsSync(`${file}.new`), false);
  assert.deepEqual(readAiSettings(file, standIn), { choice: "hosted", preset: "custom", model: "m", key: "invented-key-123" });
}));

test("a key an earlier version kept in clear is protected the first time it is read", () => inFolder((file) => {
  writeFileSync(file, JSON.stringify({ choice: "hosted", preset: "custom", model: "m", key: "invented-key-123" }));
  assert.equal(readAiSettings(file, standIn).key, "invented-key-123");
  assert.doesNotMatch(readFileSync(file, "utf8"), /invented-key-123/);
  assert.equal(readAiSettings(file, standIn).key, "invented-key-123");
}));

test("a key that cannot be protected is not saved, and one that cannot be opened is asked for again", () => inFolder((file) => {
  writeAiSettings({ choice: "hosted", preset: "custom", key: "invented-key-123" }, file, standIn);
  const before = readFileSync(file, "utf8");
  assert.throws(() => writeAiSettings({ choice: "hosted", preset: "custom", key: "another" }, file, broken), /not saved/);
  assert.equal(readFileSync(file, "utf8"), before, "the settings that were there are still there");
  assert.equal(readAiSettings(file, broken).key, undefined);
  // Settings with no key need no helper.
  writeAiSettings({ choice: "builtin" }, file, broken);
  assert.deepEqual(readAiSettings(file, broken), { choice: "builtin" });
}));

test("Windows protects a key and opens it again", { skip: process.platform !== "win32" || !existsSync(helperExe()) ? "the helper is not built" : false }, () => {
  const kept = windowsKeyGuard.protect("invented-kéy-123");
  assert.match(kept, /^[0-9a-f]+$/);
  assert.doesNotMatch(Buffer.from(kept, "hex").toString("latin1"), /invented/);
  assert.equal(windowsKeyGuard.unprotect(kept), "invented-kéy-123");
  assert.throws(() => windowsKeyGuard.unprotect("00ff"));
});

/** A zip with one entry, whose stated size may be a lie. */
function zipOf(name: string, data: Buffer, stated = data.length, method: 0 | 8 = 8): Buffer {
  const packed = method === 8 ? deflateRawSync(data) : data;
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(name.length, 26);
  local.write(name, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(stated, 24);
  central.writeUInt16LE(name.length, 28);
  central.write(name, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(local.length + packed.length, 16);
  return Buffer.concat([local, packed, central, end]);
}

test("a zip entry that does not unpack to its stated size is refused in words", () => {
  const data = Buffer.alloc(200_000, "a");
  assert.ok(readZip(zipOf("a.json", data))[0].read().equals(data));
  assert.equal(readZip(zipOf("a.json", Buffer.alloc(0)))[0].read().length, 0);
  for (const stated of [10, 199_999, 200_001]) assert.throws(() => readZip(zipOf("a.json", data, stated))[0].read(), /does not unpack to the size/, String(stated));
  assert.throws(() => readZip(zipOf("a.json", Buffer.from("abc"), 0))[0].read(), /does not unpack/);
  assert.throws(() => readZip(zipOf("a.json", Buffer.from("abc"), 2, 0))[0].read(), /does not unpack/);
});

test("a zip never unpacks more than the reader allows in all", () => {
  const entry = readZip(zipOf("a.json", Buffer.alloc(600)), 1000)[0];
  entry.read();
  assert.throws(() => entry.read(), /more than this reader will unpack/);
});

test("a review's script path is opened only if it is a plain one on this computer", () => {
  assert.ok(onADrive("C:\\work\\a.json"));
  assert.ok(onADrive("d:/work/a.json"));
  for (const bad of ["\\\\host\\share\\a.json", "//host/share/a.json", "\\/host/share/a.json", "\\\\?\\UNC\\host\\share\\a.json", "\\\\.\\C:\\a.json", "file://host/share/a.json", "file:///C:/a.json", "a.json", "C:a.json", "C:\\a.txt:x.json", "", undefined, null, 4]) assert.equal(onADrive(bad), false, String(bad));
});

test("Studio's own page may not reach a local server, and the release shell searches for no repository", () => {
  assert.match(text("index.html"), /http-equiv="Content-Security-Policy" content="connect-src 'self' ipc: http:\/\/ipc\.localhost"/);
  assert.match(text("src-tauri/src/engine.rs"), /repository_from\(exe\.as_deref\(\), named\.as_deref\(\), cfg!\(debug_assertions\)\)/);
  assert.match(text("Review Video.bat"), /set "OPENSTAGE_STUDIO_DEV_REPO=%CD%"/);
});
