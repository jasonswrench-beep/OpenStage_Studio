// The player: performs a locked script in the program, through the demo-mode hook, and saves a still picture after every
// change on screen. No AI is involved, and nothing here depends on how fast the computer is: the take records what the
// screen looks like after each change, and the timeline (src/timeline/build.ts) decides when each picture shows.
//
// The real mouse and keyboard are never used. The hook presses the controls directly, and the pointer the viewer follows
// is drawn on afterward, so nothing the person at the computer does can spoil a take.

import { parseKey, parseScroll, type Script, type Step } from "../script/format.ts";
import type { Rect, TakeLog, TakeStep } from "../timeline/build.ts";
import type { Command, ControlInfo, Hello, TextOnScreen } from "../../demo-hook/protocol.ts";
import { toFrame } from "../../demo-hook/protocol.ts";
import { accessibleScript } from "./targets.ts";

/** Something that sends a command to the program and waits for its answer. */
export interface Hook {
  send<T = unknown>(command: Command, timeoutMs?: number): Promise<T>;
}

/** Something that saves a still picture of the program's window and returns its id (its fingerprint). */
export interface Camera {
  grab(): Promise<string>;
}

export interface PlayOptions {
  /** The size of the captured frame. */
  frame: [number, number];
  /** Said as the take goes, for the log. */
  log?: (line: string) => void;
  /** How many pieces a scroll is shown in. */
  scrollPieces?: number;
  /** Ask the program for the text on screen at every picture, for the frame scan. On unless switched off. */
  readText?: boolean;
  /** Called just before each step; an error it throws fails that step (rehearsal checks steps with it). Takes never use it. */
  beforeStep?: (index: number) => Promise<void>;
}

export class StepFailed extends Error {
  readonly step: number;
  constructor(step: number, message: string) {
    super(`Step ${step + 1}: ${message}`);
    this.step = step;
  }
}

export async function play(given: Script, hook: Hook, camera: Camera, options: PlayOptions): Promise<TakeLog> {
  // For the accessibility driver, steps that name a control by role and name get an id to pass along.
  const script = accessibleScript(given);
  const log = options.log ?? (() => undefined);
  const hello = await hook.send<Hello>({ cmd: "hello" });
  log(`Connected to ${hello.program}: ${hello.controls} controls${hello.hookVersion ? "" : " (through the accessibility driver)"}, page ${hello.viewport[0]} by ${hello.viewport[1]}.`);

  const settle = () => hook.send({ cmd: "settle" });
  // The text on screen at each picture, read from the page (the frame scan also reads the pictures themselves). A program
  // with an older hook has no text command; the frame scan then reads the pictures alone.
  const pageText: Record<string, { text: string; rect: Rect }[]> = {};
  let readText = options.readText !== false && hello.hookVersion >= 2;
  if (options.readText !== false && !readText) log(`${hello.hookVersion ? "This program's demo hook cannot" : "The accessibility driver does not"} report the text on screen; the frame scan will read the pictures only.`);
  const shot = async () => {
    await settle();
    const id = await camera.grab();
    if (readText && !pageText[id]) {
      try {
        const answer = await hook.send<{ viewport: [number, number]; items: TextOnScreen[] }>({ cmd: "text" });
        pageText[id] = answer.items.map((t) => ({ text: t.text, rect: toFrame(t.rect, answer.viewport, options.frame) }));
      } catch (e) {
        readText = false;
        log(`The program did not report its text (${e instanceof Error ? e.message : String(e)}); the frame scan will read the pictures only.`);
      }
    }
    return id;
  };
  const where = async (id: string, words?: string): Promise<{ rect: Rect; label: string; role: string }> => {
    const answer = await hook.send<{ viewport: [number, number]; control: ControlInfo }>({ cmd: "position", id, ...(words ? { words } : {}) });
    if (!answer.control.visible) throw new Error(`The control "${id}" is not on screen.`);
    return { rect: toFrame(answer.control.rect, answer.viewport, options.frame), label: answer.control.label, role: answer.control.role };
  };

  await hook.send({ cmd: "reset" });
  await hook.send({ cmd: "loadDemo", name: script.startState.demoProject });
  const start = await shot();
  const steps: TakeStep[] = [];

  for (let index = 0; index < script.steps.length; index++) {
    const step = script.steps[index];
    try {
      await options.beforeStep?.(index);
      steps.push(await playStep(index, step));
    } catch (e) {
      throw e instanceof StepFailed ? e : new StepFailed(index, e instanceof Error ? e.message : String(e));
    }
    log(`Step ${index + 1} of ${script.steps.length} done: ${step.action}${step.target ? ` ${step.target}` : ""}.`);
  }
  await hook.send({ cmd: "hover", id: null });
  return { width: options.frame[0], height: options.frame[1], start, steps, ...(readText ? { pageText } : {}) };

  async function playStep(index: number, step: Step): Promise<TakeStep> {
    const out: TakeStep = { index, changes: [] };
    const calloutId = step.callout ? ("around" in step.callout ? step.callout.around : "to" in step.callout ? step.callout.to : step.callout.near) : undefined;
    if (step.words && !(hello.hookVersion >= 5)) {
      throw new Error(`${hello.hookVersion ? "This program's demo hook is older than version 5 and cannot" : "The accessibility driver cannot"} click on words inside a control.`);
    }
    if (step.target && step.action !== "open" && step.action !== "wait") {
      // On words, the pointer goes to the words rather than the middle of the control.
      out.target = await where(step.target, step.words);
      // The pointer arrives over the control: show the program's hover look.
      await hook.send({ cmd: "hover", id: step.target });
      out.hover = await shot();
    }
    if (calloutId) out.callout = await where(calloutId);

    switch (step.action) {
      case "click":
        await hook.send({ cmd: "click", id: step.target!, ...(step.words ? { words: step.words } : {}) });
        out.changes.push(await shot());
        break;
      case "type": {
        const text = step.value ?? "";
        const role = out.target?.role ?? "";
        if (step.target) {
          // Click into the field first, as a person would.
          await hook.send({ cmd: "click", id: step.target });
          out.changes.push(await shot());
        }
        if (role === "combobox") {
          await hook.send({ cmd: "type", ...(step.target ? { id: step.target } : {}), text });
          out.changes.push(await shot());
        } else {
          for (const ch of text) {
            // With a target, every key names its field, so typing never depends on where the page thinks the focus is.
            await hook.send({ cmd: "type", ...(step.target ? { id: step.target } : {}), text: ch });
            out.changes.push(await shot());
          }
        }
        break;
      }
      case "key": {
        const key = parseKey(step.value ?? "")!;
        await hook.send({ cmd: "key", ...(step.target ? { id: step.target } : {}), key: key.key, modifiers: key.modifiers });
        out.changes.push(await shot());
        break;
      }
      case "scroll": {
        const s = parseScroll(step.value)!;
        const pieces = options.scrollPieces ?? 6;
        let done = 0;
        for (let k = 1; k <= pieces; k++) {
          const target = Math.round((s.amount * k) / pieces);
          await hook.send({ cmd: "scroll", ...(step.target ? { id: step.target } : {}), axis: s.axis, amount: target - done });
          done = target;
          out.changes.push(await shot());
        }
        break;
      }
      case "open":
        await hook.send({ cmd: "reset" });
        await hook.send({ cmd: "loadDemo", name: step.value! });
        out.changes.push(await shot());
        break;
      case "wait":
        out.changes.push(await shot());
        break;
      case "drag":
        throw new Error("Drag is not performed in this version.");
    }
    if (step.target) await hook.send({ cmd: "hover", id: null });
    return out;
  }
}
