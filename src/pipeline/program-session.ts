// A program open in demo mode without recording: for reading its controls (what a scriptwriter may name) and for
// rehearsing scripts. It runs on the display local-settings.json names, like a take, and is closed afterward.

import { spawn } from "node:child_process";
import { HookServer } from "./hook-server.ts";
import { demoEnvironment, findProgram, type ProgramEntry } from "./programs.ts";
import type { ControlInfo, Hello } from "../../demo-hook/protocol.ts";

export interface ProgramSession {
  program: ProgramEntry;
  hook: HookServer;
  hello: Hello;
  close(): Promise<void>;
}

export async function openProgram(root: string, programId: string, monitor: number, log: (s: string) => void = () => undefined): Promise<ProgramSession> {
  const program = findProgram(programId);
  const hook = new HookServer();
  await hook.start();
  const launch = program.launch(root, hook.endpoint, hook.token, monitor);
  log(`Opening ${program.name} in demo mode.`);
  const app = spawn(launch.exe, launch.args, { stdio: "ignore", windowsHide: false, env: demoEnvironment() });
  try {
    await Promise.race([
      hook.contacted,
      new Promise((_, fail) => setTimeout(() => fail(new Error(`${program.name} did not start its demo-mode hook within 40 seconds.`)), 40000)),
    ]);
    const hello = await hook.send<Hello>({ cmd: "hello" });
    return {
      program, hook, hello,
      close: async () => {
        await hook.close();
        app.kill();
      },
    };
  } catch (e) {
    await hook.close();
    app.kill();
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

/** The program's controls with a demo project open, as the hook lists them. */
export async function readControls(s: ProgramSession, demoProject: string): Promise<ControlFact[]> {
  await s.hook.send({ cmd: "reset" });
  await s.hook.send({ cmd: "loadDemo", name: demoProject });
  await s.hook.send({ cmd: "settle" });
  const answer = await s.hook.send<{ controls: ControlInfo[] }>({ cmd: "list" });
  return answer.controls.map((c) => ({ id: c.id, label: c.label, role: c.role, shownAtStart: c.visible }));
}
