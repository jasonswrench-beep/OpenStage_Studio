// Steps in another program's window (format version 4, hook version 11): the validator's rules, where the pointer goes, and what
// the player tells the program and the other window, in order. No real window is used.

import test from "node:test";
import assert from "node:assert/strict";
import { SCRIPT_VERSION, type Script } from "../src/script/format.ts";
import { validateScript } from "../src/script/validate.ts";
import { play, screenToFrame, type Hook } from "../src/pipeline/player.ts";
import type { Outside, OutsideControl, OutsideKey } from "../src/pipeline/outside.ts";
import type { Command } from "../demo-hook/protocol.ts";

const script = (steps: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
  format: "openstage-studio-script",
  version: SCRIPT_VERSION,
  title: "Capture clicks in Tea Timer",
  goal: "Record a task click by click.",
  program: { id: "openstage-capture", name: "OpenStage Capture" },
  startState: { demoProject: "tea-book" },
  steps,
  ...extra,
});

const start = { action: "click", window: "Tea Timer", fallback: { role: "button", name: "Start" }, narration: "In Tea Timer, select Start.", expect: "It is brewing" };
const errorsOf = (s: unknown, controls?: string[]) => validateScript(s, controls ? { controls } : {}).errors.map((e) => `${e.path}: ${e.message}`);

test("a step in another window passes with a role and name, and is not looked for among the program's own controls", () => {
  assert.deepEqual(errorsOf(script([start]), ["bar.capture"]), []);
  assert.deepEqual(errorsOf(script([{ ...start, fallback: undefined, target: "StartButton" }]), ["bar.capture"]), []);
  assert.deepEqual(errorsOf(script([{ action: "wait", window: "Tea Timer", narration: "Tea Timer is open.", expect: "x" }])), []);
});

test("a step in another window is a click, typing or a wait, never a key, and names its control", () => {
  assert.match(errorsOf(script([{ ...start, action: "key", value: "Enter" }])).join(" "), /click, typing or a wait/);
  assert.match(errorsOf(script([{ ...start, fallback: undefined }])).join(" "), /automation id as target, or by its role and name/);
  assert.match(errorsOf(script([{ ...start, fallback: { x: 0.5, y: 0.5 } }])).join(" "), /not by x and y/);
  assert.match(errorsOf(script([{ ...start, callout: { type: "box", around: "bar.capture" } }])).join(" "), /callout does not go with/);
  // until names a control of the program itself, checked against the program's list.
  assert.deepEqual(errorsOf(script([{ ...start, until: "dialog.add" }]), ["dialog.add"]), []);
  assert.match(errorsOf(script([{ ...start, until: "dialog.nothing" }]), ["dialog.add"]).join(" "), /no control called "dialog.nothing"/);
  assert.match(errorsOf(script([{ ...start, window: "" }])).join(" "), /Say which window/);
  assert.match(errorsOf(script([start], { driver: "accessibility" })).join(" "), /goes with the hook/);
});

test("a version 3 script is read as version 4, with nothing changed", () => {
  const v = validateScript({ ...script([{ action: "click", target: "bar.capture", narration: "Select Capture.", expect: "x" }]), version: 3 });
  assert.ok(v.ok);
  assert.equal(v.script?.version, 4);
  assert.match(v.warnings.map((w) => w.message).join(" "), /Version 4 added steps in another program's window/);
});

test("a place on the desktop becomes a place in the frame of the display filmed", () => {
  // The take display above the main one, as on the development PC.
  assert.deepEqual(screenToFrame([607, -814, 110, 42], [7, -1080, 1920, 1080], [1920, 1080]), [600, 266, 110, 42]);
  // A display of another size is scaled to the frame.
  assert.deepEqual(screenToFrame([100, 100, 200, 50], [0, 0, 3840, 2160], [1920, 1080]), [50, 50, 100, 25]);
});

function fakes(shown: boolean[]) {
  const sent: Command[] = [];
  const hook: Hook = {
    async send<T>(command: Command): Promise<T> {
      sent.push(command);
      if (command.cmd === "hello") return { program: "OpenStage Capture", hookVersion: 11, viewport: [1920, 1080], devicePixelRatio: 1, controls: 3 } as T;
      if (command.cmd === "text") return { viewport: [1920, 1080], items: [] } as T;
      if (command.cmd === "outsideClick") return { recorded: true } as T;
      return null as T;
    },
  };
  const pressed: { window: string; key: OutsideKey; action: string; value?: string }[] = [];
  const control: OutsideControl = { window: "Tea Timer", id: "StartButton", name: "Start", role: "button", rect: [607, -814, 110, 42], visible: true, enabled: true, display: [7, -1080, 1920, 1080] };
  const outside: Outside = {
    async locate() {
      return control;
    },
    async press(window, key, action, value) {
      pressed.push({ window, key, action, ...(value !== undefined ? { value } : {}) });
    },
  };
  let n = 0;
  let asked = 0;
  const camera = { grab: async () => `picture-${n++}`, shown: async () => shown[Math.min(asked++, shown.length - 1)] };
  return { sent, hook, pressed, outside, camera };
}

test("a click in another window tells the program where it lands, then presses the control, and the pointer goes there", async () => {
  const f = fakes([false]);
  const s = validateScript(script([start])).script as Script;
  const take = await play(s, f.hook, f.camera, { frame: [1920, 1080], afterSettleMs: 0, outside: f.outside, film: { kind: "screen", display: [7, -1080, 1920, 1080] } });
  const clickAt = f.sent.findIndex((c) => c.cmd === "outsideClick");
  assert.deepEqual(f.sent[clickAt], { cmd: "outsideClick", x: 662, y: -793, window: "Tea Timer", label: "Start" });
  assert.deepEqual(f.pressed, [{ window: "Tea Timer", key: { role: "button", name: "Start" }, action: "invoke" }]);
  assert.deepEqual(take.steps[0].target, { rect: [600, 266, 110, 42], label: "Start", role: "button" });
  assert.equal(take.steps[0].changes.length, 1);
  // The program's window was hidden the whole time: its page was never asked to settle or for its text.
  assert.ok(!f.sent.some((c) => c.cmd === "settle" || c.cmd === "text"));
});

test("while the program's window shows, pictures wait for its page as before", async () => {
  const f = fakes([true]);
  const s = validateScript(script([start])).script as Script;
  await play(s, f.hook, f.camera, { frame: [1920, 1080], afterSettleMs: 0, outside: f.outside, film: { kind: "screen", display: [7, -1080, 1920, 1080] } });
  assert.ok(f.sent.some((c) => c.cmd === "settle"));
});

test("a step in another window is refused when the take films only the program's window, or cannot reach other windows", async () => {
  const s = validateScript(script([start])).script as Script;
  const f = fakes([true]);
  await assert.rejects(play(s, f.hook, f.camera, { frame: [1920, 1080], afterSettleMs: 0, outside: f.outside, film: { kind: "window" } }), /film "screen"/);
  const g = fakes([true]);
  await assert.rejects(play(s, g.hook, g.camera, { frame: [1920, 1080], afterSettleMs: 0 }), /cannot reach other programs' windows/);
});
