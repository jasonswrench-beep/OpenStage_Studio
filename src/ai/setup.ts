// Set Up AI.bat: choose which AI Studio uses (none, the built-in model, or a hosted service with your own key), then try
// it with one small question. Everything is asked in words, one question at a time; a key is not shown as it is typed.
//
// node src/ai/setup.ts

import { createInterface, type Interface } from "node:readline/promises";
import { openAnswerer } from "./ask.ts";
import { localAiReady, readLocalManifest } from "./local.ts";
import { getLocalAi } from "./get-local.ts";
import { describeChoice, HOSTED_NOTE, missing, PRESETS, readAiSettings, settingsFile, writeAiSettings, type AiSettings } from "./settings.ts";
import { isMain } from "../util/is-main.ts";

/**
 * Ask for a key without showing it: each character typed or pasted shows as *, Backspace takes one back, Enter ends it.
 * The question-and-answer reader is closed first, so nothing else echoes the keys. (An earlier version relied on that
 * reader's internals, which a newer Node changed, and the key was shown; this one reads the keys itself.)
 */
export async function askHidden(rl: Interface, prompt: string, input: NodeJS.ReadStream = process.stdin, out: NodeJS.WriteStream = process.stdout): Promise<string> {
  rl.close();
  out.write(prompt);
  if (!input.isTTY) {
    // Not typed at a keyboard (piped in): nothing is shown anyway, so read one line.
    const once = createInterface({ input, terminal: false });
    const line = await new Promise<string>((ok) => once.once("line", ok));
    once.close();
    out.write("\n");
    return line.trim();
  }
  return new Promise((ok, fail) => {
    let value = "";
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();
    const finish = (then: () => void) => {
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
      out.write("\n");
      then();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish(() => ok(value.trim()));
        if (ch === "\u0003") return finish(() => fail(new Error("Stopped; nothing was saved.")));
        if (ch === "\u0008" || ch === "\u007f") {
          if (value) {
            value = value.slice(0, -1);
            out.write("\b \b");
          }
        } else if (ch >= " ") {
          value += ch;
          out.write("*");
        }
      }
    };
    input.on("data", onData);
  });
}

async function choose(rl: Interface, question: string, options: string[]): Promise<number> {
  for (;;) {
    console.log(`\n${question}`);
    options.forEach((o, i) => console.log(`  ${i + 1}. ${o}`));
    const n = Number((await rl.question("Type a number and press Enter: ")).trim());
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
    console.log("That is not one of the numbers.");
  }
}

export async function setup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const now = readAiSettings();
    console.log(`Studio uses ${describeChoice(now)} now. (Settings: ${settingsFile()})`);
    const which = await choose(rl, "Which AI should Studio use to plan, write and repair scripts?", [
      "The built-in model on this computer (nothing leaves the computer; a 2.8 GB download, once)",
      ...PRESETS.map((p) => `${p.name}, with your own key`),
      "No AI (write scripts by hand)",
      "Keep it as it is",
    ]);
    let s: AiSettings;
    if (which === 0) {
      s = { choice: "builtin" };
      const m = readLocalManifest();
      if (!localAiReady(m) && !(await getLocalAi(false))) return;
    } else if (which <= PRESETS.length) {
      const p = PRESETS[which - 1];
      console.log(`\n${HOSTED_NOTE}`);
      const same = now.choice === "hosted" && now.preset === p.id;
      s = { choice: "hosted", preset: p.id };
      if (p.id === "custom") {
        s.address = (await rl.question(`The service's chat-completions address${same && now.address ? ` (Enter keeps ${now.address})` : ""}: `)).trim() || now.address;
        s.pictures = (await rl.question("Can it be shown pictures? Type Y or N: ")).trim().toLowerCase().startsWith("y");
      }
      const suggested = (same ? now.model : undefined) ?? p.defaultModel;
      s.model = (await rl.question(`The model's name${suggested ? ` (Enter keeps ${suggested})` : ""}: `)).trim() || suggested;
      const key = await askHidden(rl, `Your key for ${p.name}${same && now.key ? " (Enter keeps the one saved)" : ""}: `);
      s.key = key || (same ? now.key : undefined);
      const gap = missing(s);
      if (gap) {
        console.log(`Not saved: ${gap}`);
        return;
      }
    } else if (which === PRESETS.length + 1) {
      s = { choice: "none" };
    } else {
      s = now;
    }
    writeAiSettings(s);
    console.log(`\nSaved: Studio uses ${describeChoice(s)}.`);
    if (s.choice === "none") return;
    console.log("Trying it with one small question...");
    const a = await openAnswerer(s, console.log);
    try {
      const answer = await a.ask({ system: "Answer in one short sentence.", user: "Say that the connection works.", maxTokens: 200 });
      console.log(`It answered: ${answer.trim()}`);
      console.log("The AI is ready.");
    } finally {
      await a.close();
    }
  } finally {
    // The key question closes the reader itself; closing it twice is harmless but is skipped.
    if (!(rl as unknown as { closed?: boolean }).closed) rl.close();
  }
}

if (isMain(import.meta.url)) {
  setup().catch((e) => {
    console.error(`\nThe AI was not set up: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
