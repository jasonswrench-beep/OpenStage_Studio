import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRoot, downloadsRoot, examplesDir, helperExe, installed, studioExe, workspace, writeStudioSettings, studioSettingsFile } from "../src/paths.ts";

test("in the repository, the app's files and a person's work are both the project folder", () => {
  const env = { APPDATA: join(tmpdir(), "studio-x"), LOCALAPPDATA: join(tmpdir(), "studio-y") };
  assert.equal(installed(env), false);
  assert.equal(appRoot(env), workspace(env));
  assert.ok(existsSync(join(appRoot(env), "tools", "kokoro-model.json")));
  assert.equal(helperExe(env), join(appRoot(env), "studio-helper", "target", "release", "studio-helper.exe"));
  assert.equal(studioExe(env), join(appRoot(env), "src-tauri", "target", "release", "openstage-studio.exe"));
});

test("installed, the work goes to Documents/OpenStage Studio (or the chosen folder) and the examples are copied there once", () => {
  const base = mkdtempSync(join(tmpdir(), "studio-paths-"));
  try {
    const res = join(base, "install");
    mkdirSync(join(res, "examples"), { recursive: true });
    writeFileSync(join(res, "examples", "a.json"), "{}");
    const env = { OPENSTAGE_STUDIO_RESOURCES: res, OPENSTAGE_STUDIO_DOCUMENTS: join(base, "Docs"), APPDATA: join(base, "Roaming"), LOCALAPPDATA: join(base, "Local") };
    assert.equal(installed(env), true);
    assert.equal(appRoot(env), res);
    assert.equal(helperExe(env), join(res, "studio-helper.exe"));
    assert.equal(workspace(env), join(base, "Docs", "OpenStage Studio"));
    assert.equal(readFileSync(join(examplesDir(env), "a.json"), "utf8"), "{}");
    writeStudioSettings({ workspace: join(base, "Elsewhere") }, studioSettingsFile(env));
    assert.equal(workspace(env), join(base, "Elsewhere"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("downloads in the old place are moved to Studio's data folder once, and nothing is downloaded again", () => {
  const base = mkdtempSync(join(tmpdir(), "studio-paths-"));
  try {
    const old = join(base, "OpenStage Studio", "voices", "kokoro-r");
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "model.onnx"), "voice");
    const root = downloadsRoot({ LOCALAPPDATA: base });
    assert.equal(root, join(base, "org.openstage.studio"));
    assert.equal(readFileSync(join(root, "voices", "kokoro-r", "model.onnx"), "utf8"), "voice");
    assert.equal(existsSync(old), false, "moved, not copied");
    downloadsRoot({ LOCALAPPDATA: base });
    assert.equal(readFileSync(join(root, "voices", "kokoro-r", "model.onnx"), "utf8"), "voice", "a second call changes nothing");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
