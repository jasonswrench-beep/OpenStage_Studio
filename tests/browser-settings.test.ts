import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { demoEnvironment, TAKE_BROWSER_SETTINGS } from "../src/pipeline/programs.ts";

const ROOT = resolve(import.meta.dirname, "..");

test("Studio's window starts its browser engine with exactly a take's settings, so the two can share one data folder", () => {
  const rust = readFileSync(join(ROOT, "src-tauri", "src", "main.rs"), "utf8");
  const shell = /const BROWSER_SETTINGS: &str = "([^"]*)";/.exec(rust)?.[1];
  assert.equal(shell, TAKE_BROWSER_SETTINGS);
  assert.equal(demoEnvironment({}).WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, TAKE_BROWSER_SETTINGS);
  assert.doesNotMatch(rust, /data_directory/, "the practice program shares Studio's data folder (its own made takes differ)");
});
