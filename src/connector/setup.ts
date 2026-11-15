// Set Up Connector.bat: turn the connector (MCP) on or off, name the one folder an assistant may use, and show the lines
// that connect an assistant to it. Asked in words, one question at a time.
//
// node src/connector/setup.ts

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { connectorFile, readConnector, writeConnector } from "./settings.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** What an assistant needs to start the connector: the command, its arguments, and a settings-file block. */
export function connectLines(node = process.execPath, root = ROOT) {
  const server = join(root, "src", "connector", "server.ts");
  const block = { mcpServers: { "openstage-studio": { command: node, args: [server] } } };
  return { command: node, args: [server], block: JSON.stringify(block, null, 2) };
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const now = readConnector();
    console.log(`The connector is ${now.on ? `on, for the folder ${now.folder}` : "off"}. (Settings: ${connectorFile()})`);
    console.log("With it on, an assistant you use can read manuals and programs' controls, write tutorial scripts into one folder,");
    console.log("and rehearse them on your take screen. It cannot record, approve or export a video.\n");
    const on = (await rl.question("Turn it on? Type Y for on, N for off: ")).trim().toLowerCase().startsWith("y");
    if (!on) {
      writeConnector({ on: false, ...(now.folder ? { folder: now.folder } : {}) });
      console.log("The connector is off. An assistant that tries to use it is told how to turn it on.");
      return;
    }
    const suggested = now.folder ?? join(homedir(), "Documents", "OpenStage Studio", "Connector");
    const typed = (await rl.question(`The folder it may use (Enter keeps ${suggested}): `)).trim().replace(/^"|"$/g, "");
    const folder = resolve(typed || suggested);
    if (!existsSync(folder)) {
      mkdirSync(folder, { recursive: true });
      console.log(`Made the folder ${folder}. Put the manuals you want scripts for in it.`);
    }
    writeConnector({ on: true, folder });
    const c = connectLines();
    console.log(`\nThe connector is on, for ${folder} only.\n`);
    console.log("To connect an assistant that reads its servers from a settings file, add this block to that file:\n");
    console.log(c.block);
    console.log("\nFor an assistant that asks for the command that starts a server:");
    console.log(`  Command: ${c.command}`);
    console.log(`  Argument: ${c.args[0]}`);
    console.log("\nTurn it off again here at any time; it takes effect at an assistant's next request.");
  } finally {
    rl.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`\nThe connector was not set up: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
