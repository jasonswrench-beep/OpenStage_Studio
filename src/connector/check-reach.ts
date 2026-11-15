// The acceptance test for phase 5 (reach), as the spec states it:
//
//   1. A program without the hook records through the accessibility driver: Practice Planner, started with its hook off,
//      makes a whole video from examples/accessibility/plan-a-lesson-no-hook.json.
//   2. An outside assistant builds and rehearses a script through the connector: Claude (the key Set Up AI.bat saved)
//      is given only the connector's tools, over the connector's own protocol, and asked to write a script for a task in
//      the invented manual and rehearse it until it passes. Studio then rehearses the script itself, independently.
//
// Everything goes into renders\reach-check\. The connector runs with its own settings there (on, for that folder only),
// so the person's own connector settings are not touched.
//
// node src/connector/check-reach.ts

import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { presetOf, readAiSettings } from "../ai/settings.ts";
import { rehearse } from "../ai/rehearse.ts";
import { formatOnly } from "../batch/check-script.ts";
import { FRAME, makeVideo, takeMonitor } from "../pipeline/make-video.ts";
import { openProgram } from "../pipeline/program-session.ts";
import { validateScript } from "../script/validate.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** A small client for the connector: start it, and send it messages one at a time. */
function connect(settingsFile: string) {
  const server = spawn(process.execPath, [join(ROOT, "src", "connector", "server.ts")], {
    stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, OPENSTAGE_CONNECTOR_SETTINGS: settingsFile },
  });
  const waiting = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>();
  createInterface({ input: server.stdout! }).on("line", (l) => {
    const m = JSON.parse(l) as { id?: number; result?: unknown; error?: { message: string } };
    if (typeof m.id === "number") waiting.get(m.id)?.(m);
  });
  server.stderr!.on("data", () => undefined);
  let next = 1;
  const request = <T>(method: string, params: Record<string, unknown> = {}) => new Promise<T>((ok, fail) => {
    const id = next++;
    waiting.set(id, (m) => (m.error ? fail(new Error(m.error.message)) : ok(m.result as T)));
    server.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const notify = (method: string) => server.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  return { request, notify, close: () => server.stdin!.end() };
}

export async function checkReach(log: (s: string) => void = console.log): Promise<boolean> {
  const base = join(ROOT, "renders", "reach-check");
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const lines = ["Reach acceptance check", ""];
  let pass = true;
  const result = (ok: boolean, what: string) => {
    pass &&= ok;
    lines.push(`${ok ? "PASS" : "FAIL"}: ${what}`);
    log(`${ok ? "PASS" : "FAIL"}: ${what}`);
  };

  // 1. A program without the hook, through the accessibility driver.
  log("\n=== 1. A program without the hook ===");
  const a11y = join(ROOT, "examples", "accessibility", "plan-a-lesson-no-hook.json");
  try {
    const made = await makeVideo(a11y, join(base, "accessibility"), { monitor: takeMonitor(), log });
    result(existsSync(made.video) && made.take.steps.length === validateScript(JSON.parse(readFileSync(a11y, "utf8"))).script!.steps.length,
      `Practice Planner, with its hook off, recorded through the accessibility driver: all ${made.take.steps.length} steps, ${(made.timeline.durationMs / 1000).toFixed(1)} seconds`);
  } catch (e) {
    result(false, `the accessibility driver's video was not made: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. An outside assistant, through the connector.
  log("\n=== 2. An outside assistant through the connector ===");
  const ai = readAiSettings();
  if (ai.choice !== "hosted" || presetOf(ai)?.protocol !== "anthropic" || !ai.key) {
    result(false, "the connector test needs Claude as the AI (Set Up AI.bat), to act as the outside assistant");
  } else {
    const model = ai.model ?? presetOf(ai)!.defaultModel!;
    const folder = join(base, "connector");
    mkdirSync(folder, { recursive: true });
    copyFileSync(join(ROOT, "examples", "manuals", "Practice Planner Guide.openexplainer"), join(folder, "Practice Planner Guide.openexplainer"));
    const settingsFile = join(base, "connector-settings.json");
    writeFileSync(settingsFile, JSON.stringify({ on: true, folder }));
    const c = connect(settingsFile);
    const calls: string[] = [];
    let lastRehearsal = "";
    try {
      await c.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: `Claude (${model})`, version: "check" } });
      c.notify("notifications/initialized");
      const listed = await c.request<{ tools: { name: string; description: string; inputSchema: Record<string, unknown> }[] }>("tools/list");
      const tools = listed.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema }));
      const client = new Anthropic({ apiKey: ai.key, timeout: 10 * 60 * 1000 });
      const messages: Anthropic.Beta.BetaMessageParam[] = [{
        role: "user",
        content: "The connector's folder holds a manual for Practice Planner. Using only these tools, write a tutorial script for the task \"Making a new lesson\" "
          + "(in the chapter \"Planning lessons\"), driven through the program's hook, and save it as make-a-new-lesson.json. Then rehearse it, and fix and rehearse it again "
          + "until rehearsal passes. When it passes, answer with one line: DONE make-a-new-lesson.json",
      }];
      let done = false;
      for (let turn = 0; turn < 40 && !done; turn++) {
        const r = await client.beta.messages.create({
          model, max_tokens: 16000, tools, messages,
          system: "You are an outside assistant using OpenStage Studio through its connector. Use the tools; read docs only through them. A script's format: {format: \"openstage-studio-script\", version: 2, title, goal, program: {id, name}, driver, startState: {demoProject}, steps: [{action, target, value, narration, expect}]}. Every step needs narration (one or two sentences).",
          betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        } as Anthropic.Beta.MessageCreateParamsNonStreaming);
        messages.push({ role: "assistant", content: r.content as Anthropic.Beta.BetaContentBlockParam[] });
        if (r.stop_reason === "refusal") throw new Error("Claude declined the task.");
        const uses = r.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (!uses.length) {
          done = r.content.some((b) => b.type === "text" && /DONE/.test(b.text));
          break;
        }
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const u of uses) {
          const out = await c.request<{ content: { text: string }[]; isError?: boolean }>("tools/call", { name: u.name, arguments: u.input });
          const text = out.content.map((x) => x.text).join("\n");
          calls.push(`${u.name}${out.isError ? " (error)" : ""}`);
          log(`  Claude used ${u.name}${out.isError ? ": refused" : ""}.`);
          if (u.name === "rehearse_script") lastRehearsal = text;
          results.push({ type: "tool_result", tool_use_id: u.id, content: text, ...(out.isError ? { is_error: true } : {}) });
        }
        messages.push({ role: "user", content: results });
      }
      lines.push(`  Claude's calls, in order: ${calls.join(", ")}`);
      const file = join(folder, "make-a-new-lesson.json");
      result(done && calls.includes("write_script") && calls.includes("rehearse_script") && /^Passed/.test(lastRehearsal),
        `Claude wrote and rehearsed a script through the connector (${calls.length} tool calls; its last rehearsal: ${lastRehearsal.split("\n")[0] || "none"})`);
      // Studio's own, independent rehearsal of what Claude wrote.
      if (existsSync(file)) {
        const v = validateScript(JSON.parse(readFileSync(file, "utf8")));
        let passed = false;
        if (v.ok) {
          const s = await openProgram(ROOT, v.script!.program.id, takeMonitor(), log, v.script!.driver ?? "hook");
          try {
            passed = (await rehearse(s, v.script!, { allControls: [], check: formatOnly, frame: FRAME })).passed;
          } finally {
            await s.close();
          }
        }
        result(passed && v.script!.writtenBy?.kind === "model", `Studio's own rehearsal of the script passed (${v.script?.steps.length ?? 0} steps, written by ${v.script?.writtenBy?.name ?? "?"})`);
      } else result(false, "the script Claude was asked for is not in the folder");
    } catch (e) {
      result(false, `the connector test could not finish: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      c.close();
    }
  }

  lines.push("", pass ? "PASS: a program without the hook records, and an outside assistant builds and rehearses a script through the connector." : "FAIL: see above.");
  writeFileSync(join(base, "reach-check-report.txt"), lines.join("\n") + "\n");
  log(`\n${lines.join("\n")}`);
  return pass;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkReach().then(
    (ok) => process.exit(ok ? 0 : 1),
    (e) => {
      console.error(`\nThe check could not finish: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    },
  );
}
