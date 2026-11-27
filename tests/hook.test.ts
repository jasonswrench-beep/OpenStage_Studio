import test from "node:test";
import assert from "node:assert/strict";
import { caretMove, findWords, isLoopback, readSettings, SETTINGS_GLOBAL, shownRect, steadySelector, toFrame } from "../demo-hook/protocol.ts";
import { HookServer } from "../src/pipeline/hook-server.ts";
import { wavDurationMs } from "../src/pipeline/helper.ts";

const TOKEN = "abcdefghijklmnop1234";

test("demo mode is off unless the program was launched with the demo settings", () => {
  assert.equal(readSettings({}), null);
  assert.deepEqual(readSettings({ [SETTINGS_GLOBAL]: { endpoint: "http://127.0.0.1:5000/", token: TOKEN } }), { endpoint: "http://127.0.0.1:5000", token: TOKEN });
});

test("the hook only ever talks to this computer, with a proper token", () => {
  assert.equal(isLoopback("http://127.0.0.1:1"), true);
  assert.equal(isLoopback("http://localhost:1"), true);
  assert.equal(isLoopback("http://192.168.1.4:1"), false);
  assert.equal(isLoopback("https://example.org"), false);
  assert.equal(isLoopback("not a url"), false);
  assert.equal(readSettings({ [SETTINGS_GLOBAL]: { endpoint: "http://10.0.0.2:5000", token: TOKEN } }), null);
  assert.equal(readSettings({ [SETTINGS_GLOBAL]: { endpoint: "http://127.0.0.1:5000", token: "short" } }), null);
  assert.equal(readSettings({ [SETTINGS_GLOBAL]: { endpoint: "http://127.0.0.1:5000", token: "has spaces in it ok?" } }), null);
});

test("the arrow keys move the cursor in an editable area, and Shift selects, as they do for a person", () => {
  assert.deepEqual(caretMove("ArrowRight", ["Ctrl", "Shift"]), { alter: "extend", direction: "forward", granularity: "word" });
  assert.deepEqual(caretMove("ArrowLeft", []), { alter: "move", direction: "backward", granularity: "character" });
  assert.deepEqual(caretMove("ArrowDown", ["Shift"]), { alter: "extend", direction: "forward", granularity: "line" });
  assert.deepEqual(caretMove("End", ["Shift"]), { alter: "extend", direction: "forward", granularity: "lineboundary" });
  assert.equal(caretMove("ArrowUp", ["Alt"]), null, "Alt with an arrow is the program's own key");
  assert.equal(caretMove("Home", ["Ctrl"]), null);
  assert.equal(caretMove("Enter", []), null);
});

test("a tick box whose input is hidden is where its label is, so the pointer goes to what is drawn", () => {
  assert.deepEqual(shownRect([74, 1811, 1, 32], [70, 700, 400, 24]), [70, 700, 400, 24]);
  assert.deepEqual(shownRect([74, 700, 18, 18], [70, 700, 400, 24]), [74, 700, 18, 18], "a tick box that shows is where it is");
  assert.deepEqual(shownRect([74, 1811, 1, 32], null), [74, 1811, 1, 32], "with no label, the input's own place");
});

test("a control's place on the page is scaled to the captured frame", () => {
  assert.deepEqual(toFrame([100, 20, 120, 40], [1280, 720], [1920, 1080]), [150, 30, 180, 60]);
});

/** A stand-in for a program's hook: asks for commands and answers them the way the real one does. */
async function fakeHook(server: HookServer, answer: (cmd: Record<string, unknown>) => unknown, rounds: number) {
  const base = `${server.endpoint}/hook`;
  for (let k = 0; k < rounds; k++) {
    const res = await fetch(`${base}/next?token=${server.token}`);
    if (res.status !== 200) {
      k--;
      continue;
    }
    const cmd = (await res.json()) as Record<string, unknown> & { seq: number };
    let reply;
    try {
      reply = { seq: cmd.seq, ok: true, result: answer(cmd) };
    } catch (e) {
      reply = { seq: cmd.seq, ok: false, error: (e as Error).message };
    }
    await fetch(`${base}/reply?token=${server.token}`, { method: "POST", body: JSON.stringify(reply), headers: { "Content-Type": "text/plain" } });
  }
}

test("commands go to the program and answers come back, in order", async () => {
  const server = new HookServer();
  await server.start();
  try {
    const hook = fakeHook(server, (cmd) => {
      if (cmd.cmd === "click") throw new Error("There is no control called \"nope\" on screen.");
      return { echoed: cmd.cmd };
    }, 3);
    assert.deepEqual(await server.send({ cmd: "hello" }), { echoed: "hello" });
    assert.deepEqual(await server.send({ cmd: "settle" }), { echoed: "settle" });
    await assert.rejects(server.send({ cmd: "click", id: "nope" }), /no control called "nope"/);
    await hook;
  } finally {
    await server.close();
  }
});

test("a request without the take's token is refused", async () => {
  const server = new HookServer();
  await server.start();
  try {
    const res = await fetch(`${server.endpoint}/hook/next?token=wrong-token-123456`);
    assert.equal(res.status, 403);
  } finally {
    await server.close();
  }
});

test("a program that never answers is reported, not waited on forever", async () => {
  const server = new HookServer();
  await server.start();
  try {
    await assert.rejects(server.send({ cmd: "hello" }, 200), /did not answer "hello"/);
  } finally {
    await server.close();
  }
});

test("a WAV file's length is read from its header", () => {
  const rate = 16000;
  const samples = 8000;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(samples * 2, 40);
  assert.equal(wavDurationMs(buf), 500);
  assert.throws(() => wavDurationMs(Buffer.from("nope nope nope")), /not a WAV/);
});

test("in demo mode focus and hover follow the hook's markers, not the window's state", () => {
  assert.equal(steadySelector("input:focus"), "input[data-demo-focus]");
  assert.equal(steadySelector("button:focus-visible, a:hover"), "button[data-demo-focus-visible], a[data-demo-hover]");
  assert.equal(steadySelector(".row:focus-within > label"), ".row[data-demo-focus-within] > label");
  assert.equal(steadySelector("input:not(:focus)"), "input:not([data-demo-focus])");
  assert.equal(steadySelector(".focused-item:hover-ish"), ".focused-item:hover-ish", "only the real pseudo-classes");
  assert.equal(steadySelector("button.primary"), "button.primary");
});

test("words inside a control are found where they first appear, as written or else ignoring case", () => {
  assert.deepEqual(findWords("Email mostly at D Akafer at Riverside.edu", "D Akafer"), [16, 24]);
  assert.deepEqual(findWords("at Riverside, then at riverside", "riverside"), [22, 31]);
  assert.deepEqual(findWords("Yes, exactly. yes", "YES"), [0, 3]);
  assert.equal(findWords("nothing here", "Akafer"), null);
  assert.equal(findWords("text", ""), null);
});