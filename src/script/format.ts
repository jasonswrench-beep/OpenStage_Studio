// The tutorial script: one plain JSON file that fully describes one video (docs/script-format.md).
// A person or any AI model can write one, and the player performs it without interpretation.

export const SCRIPT_FORMAT = "openstage-studio-script";
export const SCRIPT_VERSION = 3;

/** What the player does in a step. Drag is part of the format but not performed yet (canvas work comes later). */
export const ACTIONS = ["click", "type", "key", "drag", "scroll", "open", "wait"] as const;
export type Action = (typeof ACTIONS)[number];

/** The ways the player can find controls. Only the demo-mode hook is built in this version. */
export const DRIVERS = ["hook", "accessibility", "position"] as const;
export type Driver = (typeof DRIVERS)[number];

export interface Program {
  /** A short stable name for the program, such as `practice-notes`. */
  id: string;
  /** The program's name as the viewer sees it on the title card. */
  name: string;
  version?: string;
}

export interface StartState {
  /** A demo project from the program's demo library, by name. Never a file path. */
  demoProject: string;
  /** Anything else about where the video starts, in words (for people; the player does not read it). */
  note?: string;
}

/** A second way to find a control, for drivers other than the hook. */
export interface Fallback {
  role?: string;
  name?: string;
  /** Where the control is, as a share of the window's width and height (0 to 1). */
  x?: number;
  y?: number;
}

export type Callout =
  | { type: "box"; around: string; color?: string }
  | { type: "arrow"; to: string; from?: Side; color?: string }
  | { type: "label"; text: string; near: string; side?: Side; color?: string };

export type Side = "left" | "right" | "above" | "below";

export interface Step {
  action: Action;
  /** The control, by its stable name (not its visible label). */
  target?: string;
  fallback?: Fallback;
  /** Text to type, a key to press (`Ctrl+S`), a demo project to open, how far to scroll (`down 300`), or seconds to wait. */
  value?: string;
  /** For a click: words inside the control to click on. They are selected, as a double-click on a word or a drag across
   * several would, so a key or typing that follows works on them (the hook driver, hook version 5). */
  words?: string;
  /** With words: put the cursor just before or after them instead of selecting them. */
  caret?: "before" | "after";
  /** For a click or a key that starts work of the program's own (sealing, unlocking): the control that shows it is done. The
   * step's picture waits until it is on screen, at most a minute, so it never catches the work halfway. */
  until?: string;
  /** One or two sentences spoken over the step. */
  narration?: string;
  /** Set when a step has no narration on purpose. */
  silent?: boolean;
  callout?: Callout;
  /** Whether the yellow click circle shows. On by default for clicks. */
  highlight?: boolean;
  /** Extra pause after the narration ends, in seconds. */
  hold?: number;
  /** What must be true afterward, used in rehearsal. */
  expect?: string;
  /** Starts a chapter of the video's chapter list here, with this name. */
  chapter?: string;
  /** For a viewer who cannot see the screen: what this step shows that the narration does not say (version 3). Goes into
   * the video's description track (descriptions.vtt) and the transcript. */
  describe?: string;
}

export interface Script {
  format: typeof SCRIPT_FORMAT;
  version: number;
  title: string;
  goal: string;
  program: Program;
  driver?: Driver;
  startState: StartState;
  playlist?: { name: string; position: number };
  /** Spoken over the title card. */
  intro?: string;
  /** Spoken over the end card. */
  outro?: string;
  /** Who wrote the script, for the guard report: a person, or the AI model's name, and whether a person edited it. */
  writtenBy?: { kind: "person" | "model"; name?: string; editedByPerson?: boolean };
  /** For the publishing package (version 2). */
  publish?: Publish;
  /** Blurred boxes over parts of the picture, chosen in review (version 2). */
  redactions?: Redaction[];
  steps: Step[];
}

/** What the publishing package says about the video. The title is the script's title. */
export interface Publish {
  /** The description's opening words. The chapter list follows it. */
  description?: string;
  tags?: string[];
  /** The step whose picture goes on the thumbnail (counting from 1). The last step's picture if left out. */
  thumbnailStep?: number;
}

/** A blurred box over part of the picture, from the start of one step to the end of another. */
export interface Redaction {
  /** Left, top, width and height, in pixels of the 1920 by 1080 video. */
  box: [number, number, number, number];
  /** The first step it covers (counting from 1), or 0 for the starting picture before step 1. */
  fromStep: number;
  /** The last step it covers. */
  toStep: number;
  /** Why it is there, for the guard report. */
  reason?: string;
}

/** The keys a `key` step can press. Modifiers are joined with +, as in `Ctrl+Shift+S`. */
export const KEY_NAMES = [
  "Enter", "Escape", "Tab", "Backspace", "Delete", "Space", "Home", "End", "PageUp", "PageDown",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
] as const;
export const MODIFIERS = ["Ctrl", "Alt", "Shift"] as const;

/** A key chord split into its modifiers and its key, or null if it is not one the player can press. */
export function parseKey(value: string): { modifiers: string[]; key: string } | null {
  const parts = value.split("+").map((p) => p.trim());
  if (parts.some((p) => p === "")) return null;
  const key = parts.pop()!;
  const modifiers = parts;
  if (new Set(modifiers).size !== modifiers.length) return null;
  if (!modifiers.every((m) => (MODIFIERS as readonly string[]).includes(m))) return null;
  const ok = /^[A-Za-z0-9]$/.test(key) || /^F([1-9]|1[0-2])$/.test(key) || (KEY_NAMES as readonly string[]).includes(key);
  return ok ? { modifiers, key: key.length === 1 ? key.toUpperCase() : key } : null;
}

/** How far a `scroll` step moves, from `down 300` (CSS pixels). Positive is down or right. */
export function parseScroll(value: string | undefined): { axis: "x" | "y"; amount: number } | null {
  const m = /^(up|down|left|right) (\d{1,5})$/.exec((value ?? "down 300").trim());
  if (!m) return null;
  const n = Number(m[2]);
  if (m[1] === "up") return { axis: "y", amount: -n };
  if (m[1] === "down") return { axis: "y", amount: n };
  if (m[1] === "left") return { axis: "x", amount: -n };
  return { axis: "x", amount: n };
}

/** The steps whose narration is spoken (in order), with their indexes. */
export function spokenSteps(script: Script): { index: number; text: string }[] {
  return script.steps.flatMap((s, index) => (s.narration && !s.silent ? [{ index, text: s.narration }] : []));
}
