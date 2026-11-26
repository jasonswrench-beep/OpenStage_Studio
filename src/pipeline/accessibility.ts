// The accessibility driver: drives a program that has no demo-mode hook, through Windows UI Automation, the interface
// screen readers use (studio-helper's `uia` command). To the player it looks like the hook: it answers the same commands,
// so takes, rehearsal and the release check work unchanged.
//
// It finds a control by its automation id (a script's `target`), or, for a control with none, by its role and name (a
// step's `fallback`). It presses, fills and chooses through the interface, never with the real mouse or keyboard, so
// steps that only a keyboard can do (key presses, scrolling, opening another demo project mid-script) are not offered.
// Without the hook a program's own effects are not held still, so a take is the same to the eye, not to the pixel.

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Command, ControlInfo, Hello } from "../../demo-hook/protocol.ts";
import { helperPath } from "./helper.ts";
import { fallbackId, keyOf } from "./targets.ts";
import type { Hook } from "./player.ts";
import { demoEnvironment, type ProgramEntry } from "./programs.ts";


interface UiaControl {
  id: string;
  name: string;
  role: string;
  rect: [number, number, number, number];
  visible: boolean;
  enabled: boolean;
  focused: boolean;
  value: string | null;
}

export class AccessibilityDriver implements Hook {
  private helper: ChildProcess | null = null;
  private waiting: ((v: { ok: boolean; result?: unknown; error?: string }) => void)[] = [];
  private app: ChildProcess | null = null;
  private demo: string | null = null;
  /** Whether a step has changed the program since it opened its demo project. */
  private dirty = false;
  private viewport: [number, number] = [0, 0];
  private root: string;
  readonly program: ProgramEntry;
  private monitor: number;
  private log: (s: string) => void;

  constructor(root: string, program: ProgramEntry, monitor: number, log: (s: string) => void = () => undefined) {
    if (!program.launchPlain) throw new Error(`${program.name} cannot be started for the accessibility driver yet (src/pipeline/programs.ts).`);
    this.root = root;
    this.program = program;
    this.monitor = monitor;
    this.log = log;
  }

  private async startHelper(): Promise<void> {
    const h = spawn(helperPath(this.root), ["uia"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    this.helper = h;
    const lines = createInterface({ input: h.stdout! });
    const ready = new Promise<void>((ok, fail) => {
      h.once("error", fail);
      lines.once("line", () => ok());
    });
    await ready;
    lines.on("line", (l) => {
      try {
        this.waiting.shift()?.(JSON.parse(l));
      } catch {
        // Not a reply.
      }
    });
  }

  private ask<T>(command: Record<string, unknown>): Promise<T> {
    return new Promise((ok, fail) => {
      this.waiting.push((v) => (v.ok ? ok(v.result as T) : fail(new Error(v.error ?? "The accessibility driver could not do that."))));
      this.helper!.stdin!.write(JSON.stringify(command) + "\n");
    });
  }

  /** Start (or restart) the program with a demo project open, and find its window. */
  async launch(demo: string): Promise<void> {
    if (!this.helper) await this.startHelper();
    if (this.app) {
      this.app.kill();
      await new Promise((r) => setTimeout(r, 800));
    }
    const l = this.program.launchPlain!(this.root, this.monitor, demo);
    this.log(`Starting ${this.program.name} without its hook (the accessibility driver).`);
    this.app = spawn(l.exe, l.args, { stdio: "ignore", windowsHide: false, env: demoEnvironment() });
    const started = Date.now();
    for (;;) {
      try {
        const a = await this.ask<{ width: number; height: number }>({ cmd: "attach", window: this.program.windowTitle });
        const list = await this.ask<{ viewport: [number, number]; controls: UiaControl[] }>({ cmd: "list" });
        if (list.controls.length) {
          this.viewport = [a.width, a.height];
          break;
        }
      } catch {
        // Not open yet.
      }
      if (Date.now() - started > 40000) throw new Error(`${this.program.name}'s window did not appear within 40 seconds.`);
      await new Promise((r) => setTimeout(r, 500));
    }
    this.demo = demo;
    this.dirty = false;
  }

  private async controls(): Promise<{ viewport: [number, number]; controls: UiaControl[] }> {
    return this.ask({ cmd: "list" });
  }

  private info(c: UiaControl): ControlInfo {
    return {
      id: c.id || fallbackId(c.role, c.name), label: c.name, role: c.role, rect: c.rect, visible: c.visible, enabled: c.enabled,
      ...(c.value !== null ? { value: c.value } : {}), focused: c.focused,
    };
  }

  private async find(id: string): Promise<{ viewport: [number, number]; control: UiaControl }> {
    const k = keyOf(id);
    const { viewport, controls } = await this.controls();
    const matches = controls.filter((c) => (k.id ? c.id === k.id : (!k.role || c.role === k.role) && c.name.replace(/\s+/g, " ").toLowerCase() === (k.name ?? "").replace(/\s+/g, " ").trim().toLowerCase()));
    const control = matches.find((c) => c.visible) ?? matches[0];
    if (!control) throw new Error(`There is no control ${k.id ? `"${k.id}"` : `${k.role ?? "control"} called "${k.name}"`} in the window.`);
    return { viewport, control };
  }

  async send<T = unknown>(command: Command): Promise<T> {
    const act = async (id: string, action: string, value?: string) => {
      this.dirty = true;
      await this.ask({ cmd: "do", key: keyOf(id), action, ...(value !== undefined ? { value } : {}) });
      return null;
    };
    switch (command.cmd) {
      case "hello": {
        const { controls } = await this.controls();
        const hello: Hello = { program: this.program.name, hookVersion: 0, viewport: this.viewport, devicePixelRatio: 1, controls: controls.length };
        return hello as T;
      }
      case "list": {
        const { viewport, controls } = await this.controls();
        return { viewport, controls: controls.map((c) => this.info(c)) } as T;
      }
      case "position": {
        const { viewport, control } = await this.find(command.id);
        return { viewport, control: this.info(control) } as T;
      }
      case "hover":
      case "settle":
        // No hover look without the mouse; the take itself waits for the window to stop changing.
        await new Promise((r) => setTimeout(r, command.cmd === "settle" ? 120 : 0));
        return null as T;
      case "click": {
        // Clicking into a box or a list only places the pointer: typing through the interface needs no focus, and leaving
        // the focus alone keeps a blinking cursor out of the pictures.
        const { control } = await this.find(command.id);
        if (control.role === "textbox" || control.role === "combobox") return null as T;
        return (await act(command.id, "invoke")) as T;
      }
      case "focus":
        return (await act(command.id, "focus")) as T;
      case "type": {
        let id = command.id;
        if (!id) {
          const f = await this.ask<{ control: UiaControl | null }>({ cmd: "focused" });
          if (!f.control) throw new Error("Nothing has the keyboard focus to type into. Give the step a target.");
          id = f.control.id || fallbackId(f.control.role, f.control.name);
        }
        const { control } = await this.find(id);
        return (await act(id, control.role === "combobox" ? "choose" : "append", command.text)) as T;
      }
      case "loadDemo":
        if (this.demo === command.name && !this.dirty) return null as T;
        await this.launch(command.name);
        return null as T;
      case "reset":
        // Starting again happens when the next demo project is opened (the program is restarted with it).
        return null as T;
      case "key":
        throw new Error("The accessibility driver cannot press keys (it never uses the real keyboard). Use a click or typing step instead.");
      case "scroll":
        throw new Error("The accessibility driver cannot scroll yet.");
      case "reveal":
        // Never sent: the driver says hook version 0, and the player asks only a hook of version 10 or later.
        throw new Error("The accessibility driver cannot scroll yet.");
      case "text":
        throw new Error("The accessibility driver does not report the text on screen; the frame scan reads the pictures.");
      case "outsideClick":
        // Steps in another program's window go with the hook (the validator refuses them here), so there is nothing to record.
        return { recorded: false } as T;
    }
  }

  async close(): Promise<void> {
    this.helper?.stdin?.end();
    this.app?.kill();
    await new Promise((r) => setTimeout(r, 300));
    this.helper?.kill();
  }
}
