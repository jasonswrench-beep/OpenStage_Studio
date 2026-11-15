// The engine check: bundles the engine, lays out Studio's files as the installer does (tools/stage-app.mjs), and runs the
// bundled engine from there the way installed Studio's window does, with its own empty Documents and settings folders.
// It must find its work folder and examples, list the example script, make the example video with the very same frames
// the repository makes, and start the connector for an assistant.
//
// node tools/check-engine.mjs            (Check Engine.bat; opens the practice program on the take screen)

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleEngine } from "./bundle-engine.mjs";
import { stageApp } from "./stage-app.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lines = [];
let pass = true;
const check = (ok, what) => {
  pass &&= ok;
  lines.push(`${ok ? "PASS" : "FAIL"}: ${what}`);
  console.log(lines.at(-1));
};

/** Run one job the way the window does; returns its result (or throws with its message). */
function job(env, node, engine, name, args = {}, { show = false } = {}) {
  return new Promise((done, fail) => {
    const p = spawn(node, [engine, name, JSON.stringify(args)], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let rest = "";
    let result;
    let failed;
    p.stdout.on("data", (d) => {
      rest += d;
      const parts = rest.split("\n");
      rest = parts.pop();
      for (const l of parts) {
        const e = JSON.parse(l);
        if (e.type === "log" && show) console.log(`  ${e.text}`);
        if (e.type === "result") result = e.value;
        if (e.type === "failed") failed = e.message;
      }
    });
    p.stderr.on("data", (d) => process.stderr.write(d));
    p.on("close", () => (failed || !result ? fail(new Error(failed ?? `${name} ended without a result.`)) : done(result)));
  });
}

async function main() {
  const base = join(tmpdir(), "openstage-engine-check");
  rmSync(base, { recursive: true, force: true });
  console.log("Bundling the engine...");
  const { bytes } = await bundleEngine({ quiet: true });
  console.log(`The engine is ${(bytes / 1048576).toFixed(1)} MB.`);
  const runtime = join(ROOT, "src-tauri", "runtime", "node", "node.exe");
  const { dest: app, missing } = stageApp(join(base, "app"), { skip: existsSync(runtime) ? [] : ["node/"] });
  check(!missing.length, `every file the installer carries is there${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
  const node = existsSync(runtime) ? join(app, "node", "node.exe") : process.execPath;
  if (!existsSync(runtime)) lines.push(`Note: the pinned Node.js is not fetched yet, so this Node.js (${process.version}) ran the engine.`);
  const engine = join(app, "engine", "engine.mjs");
  const studio = join(ROOT, "src-tauri", "target", "release", "openstage-studio.exe");
  if (!existsSync(studio)) throw new Error(`OpenStage Studio is not built yet (${studio}). Run "Build Studio.bat" first.`);
  let monitor = 2;
  try {
    monitor = JSON.parse(readFileSync(join(ROOT, "local-settings.json"), "utf8")).monitor ?? 2;
  } catch {}
  const docs = join(base, "Documents");
  const appData = join(base, "Roaming");
  mkdirSync(docs, { recursive: true });
  mkdirSync(join(appData, "org.openstage.studio"), { recursive: true });
  writeFileSync(join(appData, "org.openstage.studio", "studio.json"), JSON.stringify({ monitor }) + "\n");
  // The connector on, for a folder of the check's own, so an assistant's first question gets a real answer.
  mkdirSync(join(base, "Connector"), { recursive: true });
  writeFileSync(join(appData, "org.openstage.studio", "connector.json"), JSON.stringify({ on: true, folder: join(base, "Connector") }) + "\n");
  const env = { ...process.env, OPENSTAGE_STUDIO_RESOURCES: app, OPENSTAGE_STUDIO_EXE: studio, OPENSTAGE_STUDIO_DOCUMENTS: docs, APPDATA: appData };

  const status = await job(env, node, engine, "status");
  const ws = join(docs, "OpenStage Studio");
  check(status.installed === true && status.workspace === ws, `installed, the work folder is Documents\\OpenStage Studio (${status.workspace})`);
  check(existsSync(join(ws, "Examples", "plan-a-lesson.json")), "the examples were copied into the work folder");
  check(status.monitor === monitor, `the take screen comes from Studio's settings (display ${status.monitor})`);
  check(status.voice.ready, "the voice is found in Studio's data folder");

  const library = await job(env, node, engine, "library");
  const example = library.scripts.find((s) => s.file === join(ws, "Examples", "plan-a-lesson.json"));
  check(!!example, `the example script is listed (${library.scripts.length} scripts)`);

  const lines2 = await job(env, node, engine, "connector-lines");
  check(lines2.command === node && lines2.args[0] === engine && lines2.args[1] === "connector", "the connector's lines point at Studio's own Node.js and engine");
  const hello = spawnSync(node, [engine, "connector"], {
    env,
    input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "engine-check", version: "1" } } }) + "\n",
    encoding: "utf8",
    timeout: 20000,
  });
  check(/"serverInfo"/.test(hello.stdout ?? ""), "the connector answers an assistant through the bundled engine");

  // The repository's own frames for the example, from the last repeat check, or made now.
  const reportFile = join(ROOT, "renders", "plan-a-lesson-repeat", "first", "run-report.json");
  let expected = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")).frameDigest : null;
  if (!expected) {
    console.log("Making the example from the repository first, to compare with...");
    expected = (await job({ ...process.env }, process.execPath, join(ROOT, "src", "engine", "main.ts"), "make-video", { script: join(ROOT, "examples", "plan-a-lesson.json"), monitor })).frameDigest;
  }
  console.log(`Making the example video through the bundled engine, on display ${monitor}...`);
  const made = await job(env, node, engine, "make-video", { script: example.file }, { show: true });
  check(made.folder === join(ws, "renders", "plan-a-lesson"), "the video was made in the work folder's renders");
  check(made.frameDigest === expected, `the same frames as the repository makes (fingerprints ${made.frameDigest} and ${expected})`);

  const report = [...lines, "", pass ? "PASS: the bundled engine works as installed Studio will run it." : "FAIL: see above."].join("\n") + "\n";
  console.log(`\n${report}`);
  return pass;
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (e) => {
    console.error(`\nThe engine check could not finish: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
