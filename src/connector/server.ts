// OpenStage Studio's connector: an MCP server, so an assistant a person already uses can read a manual, write tutorial
// scripts into a project folder, rehearse them, and read the results (docs/connector.md). It speaks on standard input and
// output, one JSON message per line; nothing else is ever written to standard output. It is off until a person turns it
// on, and works only inside the one folder they name.
//
// node src/connector/server.ts

import { createInterface } from "node:readline";
import { connectorProblem, readConnector } from "./settings.ts";
import { TOOLS, type Context } from "./tools.ts";
import type { ProgramFacts } from "../ai/series.ts";
import { isMain } from "../util/is-main.ts";

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = "OpenStage Studio makes narrated tutorial videos from tutorial scripts: plain JSON files, one per video, that a player performs in a real program. "
  + "With these tools you can read a manual and a program's real controls, write scripts into the connector's folder, and rehearse them (nothing is recorded). "
  + "Start with list_programs and list_files. Write each script with write_script (it is checked first) and rehearse it with rehearse_script, fixing it until it passes. "
  + "A script's target is always a control's stable name from list_controls, never its visible words. You cannot record, approve or export a video: a person does that.";

type Msg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export function startServer(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout, log: (s: string) => void = (s) => process.stderr.write(`${s}\n`)): Promise<void> {
  const send = (m: Record<string, unknown>) => output.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  const ctx: Context = { folder: "", client: "an assistant", log, facts: new Map<string, ProgramFacts>() };
  let ready = false;
  // Tool calls run one at a time, in order.
  let queue = Promise.resolve();

  const handle = async (m: Msg) => {
    const reply = (result: unknown) => m.id !== undefined && send({ id: m.id, result });
    const fail = (code: number, message: string) => m.id !== undefined && send({ id: m.id, error: { code, message } });
    switch (m.method) {
      case "initialize": {
        const s = readConnector();
        const problem = connectorProblem(s);
        if (problem) return fail(-32001, problem);
        ctx.folder = s.folder!;
        const info = (m.params?.clientInfo ?? {}) as { name?: string; version?: string };
        if (info.name) ctx.client = `${info.name}${info.version ? ` ${info.version}` : ""} (through the connector)`;
        const asked = String(m.params?.protocolVersion ?? "");
        ready = true;
        return reply({
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "openstage-studio", version: "0.1.0" },
          instructions: INSTRUCTIONS,
        });
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return;
      case "ping":
        return reply({});
      case "tools/list":
        if (!ready) return fail(-32002, "Send initialize first.");
        return reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
      case "tools/call": {
        if (!ready) return fail(-32002, "Send initialize first.");
        const name = String(m.params?.name ?? "");
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) return fail(-32602, `There is no tool called "${name}".`);
        // The settings are read again for every call, so turning the connector off takes effect at once.
        const problem = connectorProblem(readConnector());
        if (problem) return reply({ content: [{ type: "text", text: problem }], isError: true });
        try {
          const text = await tool.run((m.params?.arguments ?? {}) as Record<string, unknown>, ctx);
          return reply({ content: [{ type: "text", text }] });
        } catch (e) {
          return reply({ content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
        }
      }
      default:
        if (m.method && m.id !== undefined) return fail(-32601, `"${m.method}" is not something this server does.`);
    }
  };

  return new Promise((done) => {
    const lines = createInterface({ input });
    lines.on("line", (line) => {
      if (!line.trim()) return;
      let m: Msg;
      try {
        m = JSON.parse(line) as Msg;
      } catch {
        send({ id: null, error: { code: -32700, message: "That line is not JSON." } });
        return;
      }
      queue = queue.then(async () => void (await handle(m))).catch((e) => log(`The connector could not answer: ${e instanceof Error ? e.message : String(e)}`));
    });
    lines.on("close", () => void queue.then(done));
  });
}

if (isMain(import.meta.url)) {
  void startServer().then(() => process.exit(0));
}
