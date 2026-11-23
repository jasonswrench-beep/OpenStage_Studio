// The demo-mode hook's protocol: the messages between a program and OpenStage Studio's player.
// This file has no DOM and no Node code, so both sides and the tests share it.

/** The global a program's shell sets (only when launched with the demo flag) to switch the hook on. */
export const SETTINGS_GLOBAL = "__OPENSTAGE_DEMO_HOOK__";

export interface HookSettings {
  /** Where the player listens: always this computer, such as http://127.0.0.1:47321. */
  endpoint: string;
  /** A one-time secret the player made for this take. Requests without it are refused. */
  token: string;
  /** A folder the program may make demo projects in for this take (programs that open copies of demo projects need one). */
  workspace?: string;
}

export type Command =
  | { cmd: "hello" }
  | { cmd: "list" }
  /** `words`: the place of those words inside the control instead of the whole control (hook version 5). */
  | { cmd: "position"; id: string; words?: string; caret?: "before" | "after" }
  | { cmd: "hover"; id: string | null }
  /** `words`: click on those words inside the control and select them, as a double-click on a word or a drag across
   * several would, so the next typing replaces them (hook version 5). With `caret`, the click puts the cursor just before or
   * after those words instead, selecting nothing. */
  | { cmd: "click"; id: string; words?: string; caret?: "before" | "after" }
  | { cmd: "focus"; id: string }
  | { cmd: "type"; id?: string; text: string }
  | { cmd: "key"; id?: string; key: string; modifiers: string[] }
  | { cmd: "scroll"; id?: string; axis: "x" | "y"; amount: number }
  | { cmd: "loadDemo"; name: string }
  | { cmd: "reset" }
  | { cmd: "settle" }
  | { cmd: "text" };

/** A command as sent, with the number its reply carries. */
export type Envelope = Command & { seq: number };

export interface Reply {
  seq: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** A control as the hook reports it. The rectangle is in CSS pixels of the page; `viewport` says how big the page is. */
export interface ControlInfo {
  id: string;
  label: string;
  role: string;
  rect: [number, number, number, number];
  visible: boolean;
  enabled: boolean;
  /** For a box: the words in it now (a drop-down list: its choice). Never a password box's. (Hook version 3.) */
  value?: string;
  /** Whether the box takes several lines of text, where typing adds a line rather than replacing. (Hook version 3.) */
  multiline?: boolean;
  /** Whether it has the keyboard focus. (Hook version 3.) */
  focused?: boolean;
  /** For a tick box, a radio button or a control with aria-checked: whether it is ticked or chosen. (Hook version 7.) */
  checked?: boolean;
}

export interface Hello {
  program: string;
  hookVersion: number;
  viewport: [number, number];
  devicePixelRatio: number;
  controls: number;
}

/** A piece of text on screen, as the `text` command reports it (for the frame scan). The rectangle is in CSS pixels. */
export interface TextOnScreen {
  text: string;
  rect: [number, number, number, number];
}

/** Version 2 added the `text` command. Version 3 added a box's words, whether it takes several lines and whether it
 * has the focus to each control's report, and made Ctrl+A select a box's words. Version 4 reaches the program's own
 * frames (the same origin, such as a tools pane): their named controls are found, pressed and reported, and their text
 * read, with every place given on the program's page. No command changed. Version 5 clicks on words inside a control
 * (`click` and `position` with `words`), and Backspace and Delete remove text in an editable area. Version 6 sends the
 * focus and blur events a window that is not the active one does not get, so a program knows what has the focus, and a click's
 * events carry the point they land on and the mouse as the pointer, as a real click's do. No command changed. Version 7 makes
 * Space tick a tick box or choose a radio button and Enter in a form's box send the form, as they do for a person, reports
 * radio buttons and sliders by their own roles, and says whether a tick box is ticked. No command changed. */
export const HOOK_VERSION = 7;

/** Where some words are in a control's text: the first place they appear as written, else the first ignoring case.
 * Null when they are not there. */
export function findWords(text: string, words: string): [number, number] | null {
  if (!words) return null;
  let at = text.indexOf(words);
  if (at < 0) at = text.toLowerCase().indexOf(words.toLowerCase());
  return at < 0 ? null : [at, at + words.length];
}

/** Whether an endpoint is on this computer only. The hook never talks to anything else. */
export function isLoopback(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return (u.protocol === "http:" || u.protocol === "ws:") && ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** The hook's settings, if the program was launched in demo mode: from the global its shell set, or from the page's
 * address (`?demo-hook=<endpoint>&demo-token=<token>`). Null means demo mode is off, which is the default. */
export function readSettings(global: Record<string, unknown>, search: string): HookSettings | null {
  const fromGlobal = global[SETTINGS_GLOBAL] as Partial<HookSettings> | undefined;
  const params = new URLSearchParams(search);
  const endpoint = fromGlobal?.endpoint ?? params.get("demo-hook") ?? "";
  const token = fromGlobal?.token ?? params.get("demo-token") ?? "";
  const workspace = fromGlobal?.workspace;
  if (!endpoint || !token) return null;
  if (!isLoopback(endpoint)) return null;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  return { endpoint: endpoint.replace(/\/+$/, ""), token, ...(typeof workspace === "string" && workspace ? { workspace } : {}) };
}

/** Where a control shows. A tick box or a choice whose own input is hidden (drawn as a mark beside its words, as React Aria and many
 * others draw them) is a dot of a pixel or two, often far from what is drawn; a person clicks its label, so the label's place is
 * given, and the pointer goes there (2026-11-23: PrismQDA's tick boxes of a photograph's facts were reported 1,000 pixels below). */
export function shownRect(own: [number, number, number, number], label: [number, number, number, number] | null): [number, number, number, number] {
  const hidden = own[2] <= 2 || own[3] <= 2;
  return hidden && label && label[2] > 2 && label[3] > 2 ? label : own;
}

/** Scale a control's CSS rectangle to pixels of a captured frame of `frame` size. */
export function toFrame(rect: [number, number, number, number], viewport: [number, number], frame: [number, number]): [number, number, number, number] {
  const sx = frame[0] / viewport[0];
  const sy = frame[1] / viewport[1];
  return [Math.round(rect[0] * sx), Math.round(rect[1] * sy), Math.round(rect[2] * sx), Math.round(rect[3] * sy)];
}

/** In demo mode the page's look must not depend on whether its window is in front or where the real mouse rests, so the
 * hook rewrites the page's own style rules: focus and hover follow markers the hook sets, not the browser's state. */
const STATE_PSEUDOS: [RegExp, string][] = [
  [/:focus-visible(?![\w-])/g, "[data-demo-focus-visible]"],
  [/:focus-within(?![\w-])/g, "[data-demo-focus-within]"],
  [/:focus(?![\w-])/g, "[data-demo-focus]"],
  [/:hover(?![\w-])/g, "[data-demo-hover]"],
];

export function steadySelector(selector: string): string {
  return STATE_PSEUDOS.reduce((sel, [re, attr]) => sel.replace(re, attr), selector);
}
