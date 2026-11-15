import test from "node:test";
import assert from "node:assert/strict";
import { samePath } from "../src/util/is-main.ts";

test("a path in Windows' long-path form, or in another letter case, is the same path", { skip: process.platform !== "win32" }, () => {
  assert.equal(samePath("\\\\?\\C:\\Users\\Someone\\engine.mjs"), samePath("c:\\users\\someone\\Engine.mjs"));
  assert.notEqual(samePath("C:\\Users\\Someone\\engine.mjs"), samePath("C:\\Users\\Someone\\other.mjs"));
});
