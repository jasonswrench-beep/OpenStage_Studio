import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline/promises";
import { askHidden } from "../src/ai/setup.ts";

test("a key typed at the keyboard is never shown: only stars, and Backspace takes one back", async () => {
  const input = Object.assign(new PassThrough(), { isTTY: true, raw: false, setRawMode(on: boolean) { this.raw = on; return this; } });
  let shown = "";
  const out = Object.assign(new PassThrough(), { write: (s: string) => ((shown += s), true) });
  const rl = createInterface({ input: new PassThrough(), output: new PassThrough() });
  const answer = askHidden(rl, "Your key: ", input as never, out as never);
  input.write("sk-secret");
  input.write("x\u0008");
  input.write("1\r");
  assert.equal(await answer, "sk-secret1");
  assert.equal(shown.includes("secret"), false, "the key's letters never appear");
  assert.equal(shown, `Your key: ${"*".repeat(10)}\b \b*\n`);
  assert.equal(input.raw, false, "the keyboard is put back to normal");
});
