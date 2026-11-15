import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { startServer } from "../src/connector/server.ts";
import { fileIn } from "../src/connector/settings.ts";
import { connectLines } from "../src/connector/setup.ts";

/** Start the server on in-memory streams, with its settings in a file of our own. */
function harness(settings: unknown) {
  const base = mkdtempSync(join(tmpdir(), "studio-connector-"));
  const folder = join(base, "work");
  mkdirSync(folder);
  const file = join(base, "connector.json");
  writeFileSync(file, JSON.stringify(typeof settings === "object" && settings && "on" in settings ? { ...settings, folder } : settings));
  process.env.OPENSTAGE_CONNECTOR_SETTINGS = file;
  const input = new PassThrough();
  const output = new PassThrough();
  const done = startServer(input, output, () => undefined);
  const replies = new Map<number, (m: Record<string, unknown>) => void>();
  createInterface({ input: output }).on("line", (l) => {
    const m = JSON.parse(l);
    replies.get(m.id)?.(m);
  });
  let id = 0;
  const ask = (method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, unknown>>((ok) => {
    const n = ++id;
    replies.set(n, ok);
    input.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await ask("tools/call", { name, arguments: args })).result as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0].text, error: !!r.isError };
  };
  const end = async () => {
    input.end();
    await done;
    delete process.env.OPENSTAGE_CONNECTOR_SETTINGS;
    rmSync(base, { recursive: true, force: true });
  };
  return { folder, ask, call, end };
}

test("the connector is refused until a person turns it on", async () => {
  const h = harness({ on: false });
  try {
    const r = await h.ask("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "Test" } });
    assert.match(String((r.error as { message: string }).message), /connector is off.*Set Up Connector\.bat/);
  } finally {
    await h.end();
  }
});

test("once on, it lists its tools and works only inside its folder", async () => {
  const h = harness({ on: true });
  try {
    const init = (await h.ask("initialize", { protocolVersion: "2025-03-26", clientInfo: { name: "Test", version: "1" } })).result as Record<string, unknown>;
    assert.equal(init.protocolVersion, "2025-03-26");
    const tools = ((await h.ask("tools/list")).result as { tools: { name: string }[] }).tools.map((t) => t.name);
    assert.deepEqual(tools, ["list_programs", "list_controls", "list_files", "read_manual", "read_script", "check_script", "write_script", "rehearse_script"]);
    assert.match((await h.call("list_programs")).text, /"id": "practice-planner"[\s\S]*"drivers": \[\s*"hook",\s*"accessibility"/);
    copyFileSync("examples/manuals/Practice Planner Guide.openexplainer", join(h.folder, "Practice Planner Guide.openexplainer"));
    assert.match((await h.call("list_files")).text, /Practice Planner Guide\.openexplainer/);
    assert.match((await h.call("read_manual", { file: "Practice Planner Guide.openexplainer" })).text, /2\. Planning lessons/);
    assert.match((await h.call("read_manual", { file: "Practice Planner Guide.openexplainer", chapter: "planning" })).text, /\[\[New lesson\]\]/);
    for (const bad of ["../secret.json", "C:\\x.json", "sub/x.json"]) {
      const r = await h.call("read_script", { file: bad });
      assert.ok(r.error && /not a plain file name/.test(r.text), bad);
    }
    const notScript = await h.call("write_script", { file: "x.json", script: { format: "openstage-studio-script", version: 2, title: "" } });
    assert.match(notScript.text, /^Not written\. Problems:/);
    assert.equal(existsSync(join(h.folder, "x.json")), false, "nothing is written when a check fails");
    const repaired = await h.call("write_script", { file: "x.repaired.json", script: {} });
    assert.ok(repaired.error && /kept for repairs/.test(repaired.text));
    const unknown = await h.ask("tools/call", { name: "no_such_tool", arguments: {} });
    assert.match(String((unknown.error as { message: string }).message), /no tool called/);
  } finally {
    await h.end();
  }
});

test("file names must stay in the folder and have the right ending", () => {
  const base = mkdtempSync(join(tmpdir(), "studio-connector-"));
  try {
    assert.ok(fileIn(base, "make-a-new-lesson.json", [".json"]).endsWith("make-a-new-lesson.json"));
    assert.throws(() => fileIn(base, "notes.txt", [".json"]), /must end in \.json/);
    assert.throws(() => fileIn(base, "..json", [".json"]), /not a plain file name/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the setup gives the command, its argument and a settings-file block", () => {
  const c = connectLines("C:\\node\\node.exe", "C:\\Studio");
  assert.equal(c.command, "C:\\node\\node.exe");
  assert.equal(c.args[0], join("C:\\Studio", "src", "connector", "server.ts"));
  assert.match(c.block, /"openstage-studio": \{\s*"command": "C:\\\\node\\\\node\.exe"/);
});
