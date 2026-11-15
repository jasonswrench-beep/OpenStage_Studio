import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error The build tool is plain JavaScript.
import { folderFlags, missingFrom, namingUserFolder, NEEDED, webviewMode } from "../tools/build-installer.mjs";
// @ts-expect-error The staging tool is plain JavaScript.
import { resourceMap } from "../tools/stage-app.mjs";

const ROOT = resolve(import.meta.dirname, "..");

test("the Rust builds are told to leave out this computer's folder names, the user folder first", () => {
  const flags = folderFlags("C:\\Users\\Someone", {}, "C:\\Work\\Studio") as string[];
  assert.equal(flags[0], "--remap-path-prefix=C:\\Users\\Someone=/home");
  assert.equal(flags[3], "--remap-path-prefix=C:\\Work\\Studio=/openstage-studio");
  assert.equal(flags.at(-1), "-Clink-arg=/PDBALTPATH:%_PDB%");
});

test("a file naming the user folder is found, in either slash, either case, as text or UTF-16", () => {
  const base = mkdtempSync(join(tmpdir(), "studio-names-"));
  try {
    const home = "C:\\Users\\Someone";
    const files = {
      plain: Buffer.from("nothing here"),
      back: Buffer.from("at C:\\Users\\someone\\x"),
      fwd: Buffer.from("at c:/users/Someone/x"),
      wide: Buffer.from("C:\\Users\\Someone\\y", "utf16le"),
      escaped: Buffer.from('"C:\\\\Users\\\\Someone\\\\z"'),
    };
    for (const [n, b] of Object.entries(files)) writeFileSync(join(base, n), b);
    const named = (namingUserFolder(Object.keys(files).map((n) => join(base, n)), home) as string[]).map((f) => f.split(/[\\/]/).pop());
    assert.deepEqual(named, ["back", "fwd", "wide", "escaped"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the installer script's way of getting the web view is read", () => {
  assert.equal(webviewMode('!define INSTALLWEBVIEW2MODE "embedBootstrapper"\n'), "embedBootstrapper");
  assert.equal(webviewMode("nothing"), null);
});

test("a setup missing a file Studio needs is caught", () => {
  const base = mkdtempSync(join(tmpdir(), "studio-setup-"));
  try {
    for (const p of NEEDED as string[]) {
      mkdirSync(join(base, ...p.split("/").slice(0, -1)), { recursive: true });
      writeFileSync(join(base, ...p.split("/")), "x");
    }
    assert.deepEqual(missingFrom(base), []);
    rmSync(join(base, "engine", "engine.mjs"));
    assert.deepEqual(missingFrom(base), ["engine/engine.mjs"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("everything the installed app needs is carried as a resource", () => {
  const carried = new Set((resourceMap() as { to: string }[]).map((r) => r.to));
  for (const p of NEEDED as string[]) {
    if (p === "openstage-studio.exe") continue; // The app itself.
    const covered = carried.has(p) || [...carried].some((c) => c.endsWith("/") && p.startsWith(c));
    assert.ok(covered, `${p} is not among the installer's resources`);
  }
});

test("the engine answers in JSON lines, and refuses a job it does not have", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "src", "engine", "main.ts"), "no-such-job"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  const e = JSON.parse(r.stdout.trim());
  assert.equal(e.type, "failed");
  assert.match(e.message, /not one of the engine's jobs/);
});

test("the engine's jobs are the ones the window's shell allows, no more and no fewer", async () => {
  const { JOBS } = await import("../src/engine/main.ts");
  const rust = (await import("node:fs")).readFileSync(join(ROOT, "src-tauri", "src", "engine.rs"), "utf8");
  const listed = [.../const JOBS: &\[&str\] = &\[([^\]]*)\]/.exec(rust)![1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...listed].sort(), [...JOBS].sort());
});
