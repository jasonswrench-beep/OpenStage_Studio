import test from "node:test";
import assert from "node:assert/strict";
import { classify, usesMpl } from "../tools/licence-rules.mjs";

test("licences on the accepted list pass, alone or as a choice", () => {
  for (const l of ["MIT", "Apache-2.0", "MIT OR Apache-2.0", "MIT/Apache-2.0", "Apache-2.0 / MIT", "Unlicense OR MIT",
    "Apache-2.0 WITH LLVM-exception", "WTFPL", "MPL-2.0", "CDLA-Permissive-2.0"]) {
    assert.equal(classify(l), "ok", l);
  }
});

test("AND needs every part accepted, OR needs one choice", () => {
  assert.equal(classify("(MIT OR Apache-2.0) AND Unicode-3.0"), "ok");
  assert.equal(classify("MIT AND GPL-3.0"), "refused");
  assert.equal(classify("MIT OR GPL-3.0"), "ok");
  assert.equal(classify("(MIT OR GPL-3.0) AND SomethingNew"), "unknown");
});

test("GPL and AGPL are refused, LGPL is flagged, anything else is for a person", () => {
  assert.equal(classify("GPL-3.0-only"), "refused");
  assert.equal(classify("AGPL-3.0"), "refused");
  assert.equal(classify("LGPL-2.1-or-later"), "lgpl");
  assert.equal(classify("MIT OR Apache-2.0 OR LGPL-2.1-or-later"), "ok");
  assert.equal(classify("EUPL-1.2"), "unknown");
  assert.equal(classify(""), "unknown");
  assert.equal(classify("MIT OR"), "unknown");
});

test("MPL is noted only when it is the licence actually relied on", () => {
  assert.equal(usesMpl("MPL-2.0"), true);
  assert.equal(usesMpl("MPL-2.0 OR MIT"), false);
  assert.equal(usesMpl("MIT"), false);
});
