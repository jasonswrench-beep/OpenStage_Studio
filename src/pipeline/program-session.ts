// A program open without recording: for reading its controls (what a scriptwriter may name) and for rehearsing
// scripts. Through its demo-mode hook, or, for the accessibility driver, with the hook off. It runs on the display
// local-settings.json names, like a take, and is closed afterward.

import { spawn } from "node:child_process";
import { HookServer } from "./hook-server.ts";
import { AccessibilityDriver } from "./accessibility.ts";
import { openCompanions, OutsideHands, type Outside } from "./outside.ts";
import type { Hook } from "./player.ts";
import { demoEnvironment, findProgram, type ProgramEntry } from "./programs.ts";
import type { ControlInfo, Hello } from "../../demo-hook/protocol.ts";
import type { Driver } from "../script/format.ts";

export interface ProgramSession {
  program: ProgramEntry;
  hook: Hook;
  hello: Hello;
  driver: Driver;
  /** For steps in another program's window (with the hook only). */
  outside?: Outside;
  close(): Promise<void>;
}

export async function openProgram(root: string, programId: string, monitor: number, log: (s: string) => void = () => undefined, driver: Driver = "hook"): Promise<ProgramSession> {
  if (driver === "accessibility") return openAccessible(root, programId, monitor, log);
  const program = findProgram(programId);
  const hook = new HookServer();
  await hook.start();
  // The programs a script works in beside this one (OpenStage Capture's Tea Timer) open first, so the program opens in front of them.
  const outside = new OutsideHands(root);
  let companions: { close(): void } | null = null;
  let app: ReturnType<typeof spawn> | null = null;
  const end = async () => {
    await hook.close();
    app?.kill();
    companions?.close();
    await outside.close();
  };
  try {
    companions = await openCompanions(program, root, monitor, log, outside);
    const launch = program.launch(root, hook.endpoint, hook.token, monitor);
    log(`Opening ${program.name} in demo mode.`);
    app = spawn(launch.exe, launch.args, { stdio: "ignore", windowsHide: false, env: demoEnvironment() });
    await Promise.race([
      hook.contacted,
      new Promise((_, fail) => setTimeout(() => fail(new Error(`${program.name} did not start its demo-mode hook within 40 seconds.`)), 40000)),
    ]);
    const hello = await hook.send<Hello>({ cmd: "hello" });
    return { program, hook, hello, driver: "hook", outside, close: end };
  } catch (e) {
    await end();
    throw e;
  }
}

async function openAccessible(root: string, programId: string, monitor: number, log: (s: string) => void): Promise<ProgramSession> {
  const program = findProgram(programId);
  const first = program.demos?.[0]?.name;
  if (!first) throw new Error(`${program.name} lists no demo projects to start with (src/pipeline/programs.ts).`);
  const d = new AccessibilityDriver(root, program, monitor, log);
  try {
    await d.launch(first);
    const hello = await d.send<Hello>({ cmd: "hello" });
    return { program, hook: d, hello, driver: "accessibility", close: () => d.close() };
  } catch (e) {
    await d.close();
    throw e;
  }
}

/** One control as a scriptwriter sees it: its stable name, its words, its role, and whether it shows at the start. */
export interface ControlFact {
  id: string;
  label: string;
  role: string;
  shownAtStart: boolean;
}

/** The program's controls with a demo project open, as the hook (or the accessibility driver) lists them. */
export async function readControls(s: ProgramSession, demoProject: string): Promise<ControlFact[]> {
  await s.hook.send({ cmd: "reset" });
  await s.hook.send({ cmd: "loadDemo", name: demoProject });
  await s.hook.send({ cmd: "settle" });
  const answer = await s.hook.send<{ controls: ControlInfo[] }>({ cmd: "list" });
  return answer.controls.map((c) => ({ id: c.id, label: c.label, role: c.role, shownAtStart: c.visible }));
}
