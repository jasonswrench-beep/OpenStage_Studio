// SPDX-License-Identifier: Apache-2.0
// Makes the OpenStage Studio installer for a release, on this computer.
//
//   node tools/build-installer.mjs            build the setup file (not signed)       (Build Installer.bat)
//   node tools/build-installer.mjs --sign     build it, and sign every program in it and the setup itself
//
// What it does, in order:
//   1. fetches the pinned Node.js (tools/node-runtime.json) into src-tauri/runtime/node, checked by its SHA-256, unless the
//      same build is already there; installed Studio runs its engine with it, so nothing else is needed on the computer;
//   2. bundles the engine (tools/bundle-engine.mjs) into src-tauri/engine;
//   3. builds the helper, then the app and its per-user installer with Tauri, adding the installer's own resources
//      (src-tauri/tauri.installer.json: the engine, Node.js, the download lists and the examples). Both Rust programs are
//      given --remap-path-prefix for the user folder, Rust's own folders and this repository, and the linker is told to name
//      the debug file without its folder, so no folder name of the building computer is written into either;
//   4. checks Tauri's installer script (the web view's setup must be carried inside the installer, never downloaded while
//      installing), then unpacks the setup with 7-Zip and checks it: every file Studio needs is in it, no file in it names
//      this computer's user folder, and with --sign every program in it, and the setup, is signed and timestamped by the
//      publisher (OPENSTAGE_SIGN_PUBLISHER when it is set), except Node.js and the web view's setup, which keep their makers'
//      signatures. Signing is done by Tauri's sign command with tools/sign_windows.py, the suite's shared signing script
//      (copied unchanged from OpenExplainer; its top says which settings it needs, which come from the environment and are
//      never written into the repository). It is release tooling on the publisher's computer, never part of the product;
//   5. copies the setup to src-tauri/target/release-files/OpenStage-Studio-<RELEASE>-Setup.exe, with its SHA-256 in a
//      .sha256.txt beside it.
// docs/release.md and docs/code-signing.md say how a release is made with it.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The release this build is. Raise it for every release. */
export const RELEASE = "0.1.0-alpha.1";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(root, "src-tauri");
const helperDir = join(root, "studio-helper");
const appExe = join(tauriDir, "target", "release", "openstage-studio.exe");
const helperExe = join(helperDir, "target", "release", "studio-helper.exe");
const nodeDir = join(tauriDir, "runtime", "node");
const nsisScript = join(tauriDir, "target", "release", "nsis", "x64", "installer.nsi");
const bundleDir = join(tauriDir, "target", "release", "bundle", "nsis");
const outDir = join(tauriDir, "target", "release-files");
const signDir = join(tauriDir, "target", "signing");
const signScript = join(root, "tools", "sign_windows.py");
const sevenZip = process.env.OPENSTAGE_7ZIP ?? "C:\\Program Files\\7-Zip\\7z.exe";
/** Programs in the setup that their makers sign, never signed here: Node.js, and the web view's setup for a computer that has no web view. */
const MAKERS_FILES = new Set(["node.exe", "microsoftedgewebview2setup.exe"]);
const PROGRAM = /\.(exe|dll)$/i;
/** Files the installed app cannot work without, by their place in the install folder. */
export const NEEDED = [
  "openstage-studio.exe", "studio-helper.exe", "node/node.exe", "node/LICENSE.txt", "engine/engine.mjs", "engine/pdf.worker.mjs",
  "tools/kokoro-model.json", "tools/local-ai.json", "examples/plan-a-lesson.json", "examples/studio-project.json", "LICENSE.txt", "NOTICE.txt",
];

const say = (words) => console.log(words);
function fail(words) {
  console.error(`STOPPED: ${words}`);
  process.exit(1);
}

/**
 * The flags a Rust build here is given: one --remap-path-prefix for each folder whose name should not be written into the
 * program, and the linker's /PDBALTPATH, so the debug file is named without its folder. When several prefixes match, rustc
 * takes the last, so the broadest (the user folder) comes first and the repository last. Passed as CARGO_ENCODED_RUSTFLAGS
 * (parts separated by the character 0x1F), which keeps a space in a path whole.
 */
export function folderFlags(home = homedir(), env = process.env, repo = root) {
  const folders = [
    [home, "/home"],
    [env.CARGO_HOME || join(home, ".cargo"), "/cargo"],
    [env.RUSTUP_HOME || join(home, ".rustup"), "/rustup"],
    [repo, "/openstage-studio"],
  ];
  return [...folders.map(([folder, name]) => `--remap-path-prefix=${folder}=${name}`), "-Clink-arg=/PDBALTPATH:%_PDB%"];
}

function rustEnv(more = {}) {
  const env = { ...process.env, ...more };
  delete env.RUSTFLAGS;
  env.CARGO_ENCODED_RUSTFLAGS = folderFlags().join("\x1f");
  return env;
}

/** The files among `files` that name this computer's user folder (as text or as UTF-16, either kind of slash, any case). */
export function namingUserFolder(files, home = homedir()) {
  const needles = [...new Set([home.toLowerCase(), home.replace(/\\/g, "/").toLowerCase(), home.replace(/\\/g, "\\\\").toLowerCase()])];
  return files.filter((file) => {
    const bytes = readFileSync(file);
    const text = bytes.toString("latin1").toLowerCase();
    const wide = bytes.toString("utf16le").toLowerCase();
    return needles.some((n) => text.includes(n) || wide.includes(n));
  });
}

/** How Tauri's installer script gets the web view's setup: the value of `!define INSTALLWEBVIEW2MODE`. */
export function webviewMode(script) {
  const found = /^\s*!define\s+INSTALLWEBVIEW2MODE\s+"?([A-Za-z]+)"?\s*$/m.exec(script);
  return found ? found[1] : null;
}

/** The files of `needed` missing from an unpacked setup (NSIS keeps the install folder's layout). */
export function missingFrom(folder, needed = NEEDED) {
  return needed.filter((p) => !existsSync(join(folder, ...p.split("/"))));
}

function run(program, args, options = {}) {
  say(`  > ${program} ${args.join(" ")}`);
  const done = spawnSync(program, args, { stdio: "inherit", ...options });
  return done.status ?? 1;
}

function filesIn(folder) {
  const out = [];
  for (const entry of readdirSync(folder, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(join(entry.parentPath ?? entry.path, entry.name));
  }
  return out.sort();
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Fetch the pinned Node.js, unless it is already here. Only node.exe and its licence are kept. */
async function fetchNode() {
  const pin = JSON.parse(readFileSync(join(root, "tools", "node-runtime.json"), "utf8"));
  const infoFile = join(nodeDir, "runtime-info.json");
  const info = existsSync(infoFile) ? JSON.parse(readFileSync(infoFile, "utf8")) : null;
  if (info?.version === pin.version && info.zipSha256 === pin.sha256 && existsSync(join(nodeDir, "node.exe")) && sha256(join(nodeDir, "node.exe")) === info.exeSha256) {
    return say(`  Node.js ${pin.version}, as pinned (already here)`);
  }
  say(`  downloading Node.js ${pin.version} (${(pin.size / 1048576).toFixed(0)} MB) from ${pin.url}`);
  const res = await fetch(pin.url);
  if (!res.ok) fail(`Node.js could not be downloaded: ${res.status} ${res.statusText}.`);
  const zip = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(zip).digest("hex");
  if (zip.length !== pin.size || got !== pin.sha256) fail(`the Node.js download is not the pinned file (SHA-256 ${got}, ${zip.length} bytes).`);
  const { readZip } = await import("../src/util/zip.ts");
  rmSync(nodeDir, { recursive: true, force: true });
  mkdirSync(nodeDir, { recursive: true });
  const entries = readZip(zip);
  for (const [from, to] of Object.entries(pin.keep)) {
    const e = entries.find((x) => x.name === from);
    if (!e) fail(`${from} is not in the Node.js download.`);
    writeFileSync(join(nodeDir, to), e.read());
  }
  writeFileSync(infoFile, JSON.stringify({ version: pin.version, zipSha256: pin.sha256, exeSha256: sha256(join(nodeDir, "node.exe")) }, null, 2) + "\n");
  say(`  Node.js ${pin.version}: checked and unpacked (node.exe and its LICENSE)`);
}

function checkSignatures(files, publisher) {
  if (files.length === 0) return { ok: true, words: "" };
  const env = { ...process.env };
  if (publisher) env.OPENSTAGE_SIGN_PUBLISHER = publisher;
  else delete env.OPENSTAGE_SIGN_PUBLISHER;
  const done = spawnSync("python", ["-I", signScript, "--check", ...files], { env, encoding: "utf8" });
  return { ok: done.status === 0, words: `${done.stdout ?? ""}${done.stderr ?? ""}`.trim() };
}

function checkSetup(setup, sign) {
  if (!existsSync(sevenZip)) fail(`7-Zip is not at ${sevenZip} (set OPENSTAGE_7ZIP), so the files inside the setup could not be checked.`);
  const work = mkdtempSync(join(tmpdir(), "openstage-studio-setup-check-"));
  try {
    const unpacked = spawnSync(sevenZip, ["x", "-y", `-o${work}`, setup], { encoding: "utf8" });
    if (unpacked.status !== 0) fail(`7-Zip could not unpack the setup: ${(unpacked.stdout + unpacked.stderr).slice(-400)}`);
    const missing = missingFrom(work);
    if (missing.length) fail(`these files are missing from the setup: ${missing.join(", ")}`);
    say(`  every file Studio needs is in the setup (${NEEDED.length} checked)`);
    const inside = filesIn(work);
    const named = namingUserFolder(inside);
    if (named.length > 0) fail(`these files in the setup name this computer's user folder: ${named.map((f) => relative(work, f)).join(", ")}`);
    say(`  ${inside.length} files in the setup; none names this computer's user folder`);
    if (!sign) return;
    const programs = inside.filter((f) => PROGRAM.test(f));
    const theirs = programs.filter((f) => MAKERS_FILES.has(f.split(/[\\/]/).pop().toLowerCase()));
    const ours = [setup, ...programs.filter((f) => !theirs.includes(f))];
    const publisher = process.env.OPENSTAGE_SIGN_PUBLISHER || undefined;
    const mine = checkSignatures(ours, publisher);
    if (!mine.ok) fail(`the signed setup did not pass:\n${mine.words}`);
    const makers = checkSignatures(theirs, undefined);
    if (!makers.ok) fail(`a program its maker signs does not carry a valid signature:\n${makers.words}`);
    say(`  the setup and ${ours.length - 1} programs in it are signed and timestamped${publisher ? ` by ${publisher}` : ""}; ${theirs.length} kept their makers' signatures`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main(argv) {
  const sign = argv.includes("--sign");
  say(`OpenStage Studio ${RELEASE}: building the installer${sign ? " and signing it" : ""}.`);

  say("1. Node.js, which runs the engine.");
  await fetchNode();

  say("2. The engine.");
  const { bundleEngine } = await import("./bundle-engine.mjs");
  const { bytes } = await bundleEngine({ quiet: true });
  say(`  bundled: ${(bytes / 1048576).toFixed(1)} MB, with PDF.js's worker beside it`);

  // One extra settings file for Tauri: the installer's resources, and (with --sign) the sign command.
  mkdirSync(signDir, { recursive: true });
  const extra = JSON.parse(readFileSync(join(tauriDir, "tauri.installer.json"), "utf8"));
  delete extra.$schema;
  if (sign) {
    const ready = spawnSync("python", ["-I", signScript, "--ready"], { stdio: "inherit", env: { ...process.env, OPENSTAGE_SIGN_METADATA: join(signDir, "metadata.json") } });
    if (ready.status !== 0) fail("signing is not ready (what is missing is listed above).");
    extra.bundle.windows = { signCommand: { cmd: "python", args: ["-I", signScript, "--description", "OpenStage Studio", "%1"] } };
  }
  const extraFile = join(signDir, "tauri-installer.json");
  writeFileSync(extraFile, JSON.stringify(extra, null, 1) + "\n");

  say("3. The helper, then the app and the installer.");
  if (run("cargo", ["build", "--release", "--locked", "--manifest-path", join(helperDir, "Cargo.toml")], { env: rustEnv() }) !== 0 || !existsSync(helperExe)) {
    fail("the helper did not build.");
  }
  if (existsSync(bundleDir)) for (const name of readdirSync(bundleDir)) if (name.endsWith("-setup.exe")) rmSync(join(bundleDir, name));
  const tauri = [join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"), "build", "--config", extraFile];
  if (run(process.execPath, tauri, { cwd: root, env: rustEnv({ OPENSTAGE_SIGN_METADATA: join(signDir, "metadata.json") }) }) !== 0) {
    fail("the app or the installer did not build. What Tauri said is above.");
  }
  const setups = existsSync(bundleDir) ? readdirSync(bundleDir).filter((n) => n.endsWith("-setup.exe")) : [];
  if (setups.length !== 1) fail(`expected one setup file in ${bundleDir}, found ${setups.length}.`);
  const setup = join(bundleDir, setups[0]);

  say("4. Checks.");
  const named = namingUserFolder([appExe, helperExe, join(tauriDir, "engine", "engine.mjs")]);
  if (named.length > 0) fail(`these name this computer's user folder: ${named.join(", ")}`);
  say("  neither program, nor the engine, names this computer's user folder");
  const mode = existsSync(nsisScript) ? webviewMode(readFileSync(nsisScript, "utf8")) : null;
  if (mode !== "embedBootstrapper" && mode !== "offlineInstaller") {
    fail(`the installer would get the web view's setup by ${mode ?? "an unknown way"}, which downloads it while installing. tauri.conf.json must embed it.`);
  }
  say(`  the installer carries the web view's setup (${mode}); Studio's own installer downloads nothing`);
  checkSetup(setup, sign);

  say("5. The release file.");
  mkdirSync(outDir, { recursive: true });
  const name = `OpenStage-Studio-${RELEASE}-Setup.exe`;
  const final = join(outDir, name);
  copyFileSync(setup, final);
  const digest = sha256(final);
  writeFileSync(`${final}.sha256.txt`, `${digest}  ${name}\n`);
  say(`Done: ${final} (${statSync(final).size.toLocaleString("en-US")} bytes)\n  SHA-256 ${digest}`);
  if (!sign) say("  It is not signed: Windows will warn when it is run. It is for checking; a release is built with --sign (docs/code-signing.md).");
}

// Run only when started as a program, not when a test imports it.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  main(process.argv.slice(2)).catch((e) => fail(e instanceof Error ? e.message : String(e)));
}
