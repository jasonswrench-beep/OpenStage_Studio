// A recording (the shared capture format, C1) becomes a draft tutorial script: what the author did in the program, step
// by step, for Studio to perform again. Fixed rules, no AI, so the same recording always gives the same draft:
//
//  - a click on something with a name and a role (a button, a box, a list, a menu item...) is a click on that control;
//  - a click into a box followed by typing is one "type" step (Backspace takes back a letter, as it did when typed);
//  - a click on a drop-down list followed by a click on one of its choices is one "type" step that chooses it;
//  - Enter, Tab, Escape, the arrows and shortcuts such as Ctrl+S are "key" steps;
//  - a marker the author left starts a chapter there.
//
// What cannot be performed again is left out and said in words, in the notes: a click on something without a name, a
// right-click, anything done in another program, typing the recording left out. Every step finds its control by the role
// and name the recording holds (`fallback`); Studio then finds each one's stable id in the program itself
// (src/recording/import.ts). The narration is plain wording of each step, for a person (or an AI, if one is chosen) to
// make better before anything is recorded.

import { SCRIPT_VERSION, type Script, type Step } from "../script/format.ts";

/** One line of a take's interaction log, as the shared core's reader gives it (docs: capture-project-format.md, 6). */
export type LogLine =
  | { t: number; type: "cursorMove"; x: number; y: number }
  | { t: number; type: "click"; x: number; y: number; button: string }
  | { t: number; type: "element"; name: string; role: string }
  | { t: number; type: "key"; key: string; modifiers: string[] }
  | { t: number; type: "window"; title: string; process: string }
  | { t: number; type: "marker"; label: string };

export interface RecordingTake {
  id: number;
  readable: boolean;
  state?: "recording" | "complete" | "recovered" | "setAside";
  durationMs?: number | null;
  interactions?: { display: number; keys: boolean } | null;
  lines?: LogLine[];
}

export interface Recording {
  title: string;
  language: string;
  schemaVersion: string;
  takes: RecordingTake[];
}

/** A program Studio knows, as far as finding it in a recording goes. */
export interface KnownProgram {
  id: string;
  name: string;
  /** Part of its window's title, or its program file's name without `.exe`. */
  windowTitle: string;
  demos?: { name: string }[];
}

export interface DraftOptions {
  /** Which take (by its number). The last finished take that holds clicks, if left out. */
  take?: number;
  /** The demo project the video starts in. The program's first demo project, if left out. */
  demoProject?: string;
  title?: string;
  goal?: string;
}

export interface Draft {
  script: Script;
  /** What was left out or needs a person, in words, one line each. */
  notes: string[];
  take: number;
  program: KnownProgram;
}

/** The recorder's role words (Windows' own, in English) as Studio's. Anything else cannot be acted on. */
const ROLES: Record<string, string> = {
  button: "button", "split button": "button", "check box": "checkbox", "combo box": "combobox", edit: "textbox",
  document: "textbox", hyperlink: "link", link: "link", "list item": "listitem", list: "list", menu: "menu",
  "menu item": "menuitem", "radio button": "radio", slider: "slider", "tab item": "tab", tab: "tab", "tree item": "treeitem",
};

export const studioRole = (role: string): string | null => ROLES[role.trim().toLowerCase()] ?? null;

/** The character a key typed, for the keys the recorder writes when the keyboard is in an ordinary text field. US
 * keyboard, as the format names the keys. Null for a key that types nothing. */
export function typedCharacter(key: string, modifiers: string[]): string | null {
  const shift = modifiers.includes("shift");
  if (modifiers.some((m) => m !== "shift")) return null;
  if (/^[a-z]$/.test(key)) return shift ? key.toUpperCase() : key;
  if (/^[0-9]$/.test(key)) return shift ? ")!@#$%^&*("[Number(key)] : key;
  if (key === "space") return " ";
  const symbols: Record<string, [string, string]> = {
    semicolon: [";", ":"], comma: [",", "<"], period: [".", ">"], slash: ["/", "?"], backtick: ["`", "~"], minus: ["-", "_"],
    equals: ["=", "+"], "left-bracket": ["[", "{"], "right-bracket": ["]", "}"], backslash: ["\\", "|"], quote: ["'", '"'],
  };
  const s = symbols[key];
  if (s) return shift ? s[1] : s[0];
  if (/^numpad-[0-9]$/.test(key)) return key.slice(-1);
  return null;
}

/** A key the player can press, in the script's words (`Ctrl+S`, `Enter`), or null. */
export function keyChord(key: string, modifiers: string[]): string | null {
  const named: Record<string, string> = {
    enter: "Enter", escape: "Escape", tab: "Tab", backspace: "Backspace", delete: "Delete", space: "Space", home: "Home",
    end: "End", "page-up": "PageUp", "page-down": "PageDown", pageup: "PageUp", pagedown: "PageDown", up: "ArrowUp",
    down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  };
  let k = named[key] ?? null;
  if (!k && /^[a-z0-9]$/.test(key)) k = key.toUpperCase();
  if (!k && /^f([1-9]|1[0-2])$/.test(key)) k = key.toUpperCase();
  if (!k) return null;
  if (modifiers.includes("win")) return null;
  const mods = ["ctrl", "alt", "shift"].filter((m) => modifiers.includes(m)).map((m) => m[0].toUpperCase() + m.slice(1));
  return [...mods, k].join("+");
}

const isTypingBox = (role: string | null) => role === "textbox";

function chooseTake(r: Recording, wanted?: number): RecordingTake {
  if (wanted !== undefined) {
    const t = r.takes.find((x) => x.id === wanted);
    if (!t) throw new Error(`The recording has no take ${wanted} (it has ${r.takes.map((x) => x.id).join(", ") || "none"}).`);
    if (!t.readable) throw new Error(`Take ${wanted} could not be read (its take.json is missing or damaged).`);
    return t;
  }
  const usable = r.takes.filter((t) => t.readable && t.state !== "setAside" && (t.lines ?? []).some((l) => l.type === "click"));
  if (!usable.length) {
    throw new Error("The recording has no take with clicks in it. Interaction recording must be turned on when recording (record --interactions on), so Studio can see what was done.");
  }
  return usable[usable.length - 1];
}

/** The program a take was made in: the one whose window was in front for most of its clicks. */
function findProgram(lines: LogLine[], programs: KnownProgram[]): KnownProgram {
  const counts = new Map<KnownProgram, number>();
  let current: KnownProgram | undefined;
  for (const l of lines) {
    if (l.type === "window") current = programs.find((p) => l.title.includes(p.windowTitle) || l.process.replace(/\.exe$/i, "").toLowerCase() === p.windowTitle.toLowerCase());
    if (l.type === "click" && current) counts.set(current, (counts.get(current) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!best) {
    const seen = [...new Set(lines.flatMap((l) => (l.type === "window" ? [`${l.process}`] : [])))];
    throw new Error(`The recording was not made in a program Studio can perform (it saw ${seen.join(", ") || "no window"}; Studio knows ${programs.map((p) => p.name).join(", ")}). A program joins that list once it has the demo-mode hook (docs/demo-hook.md).`);
  }
  return best;
}

const say = {
  click: (name: string, role: string) => (role === "checkbox" ? `Select ${name}.` : role === "menuitem" ? `Choose ${name} from the menu.` : `Select ${name}.`),
  type: (name: string, value: string) => `In ${name}, type ${value}`.replace(/[.!?]?$/, "."),
  choose: (name: string, value: string) => `In the ${name} list, choose ${value}.`,
  key: (chord: string) => `Press ${chord.replace(/\+/g, " plus ")}.`,
};

/** The draft script for one take of a recording. Throws, in words, when there is nothing that can be performed. */
export function recordingToScript(r: Recording, programs: KnownProgram[], o: DraftOptions = {}): Draft {
  const take = chooseTake(r, o.take);
  const lines = take.lines ?? [];
  const program = findProgram(lines, programs);
  const notes: string[] = [];
  if (take.state === "recording") notes.push(`Take ${take.id} was not finished (the recorder stopped before saving it). Its log was read up to where it ended.`);
  if (take.interactions && !take.interactions.keys) notes.push("The recording left the keys out, so nothing typed could be read. Fill in what each box should say.");
  const steps: Step[] = [];
  let inProgram = false;
  let chapter: string | undefined;
  /** The box being typed into, and what has been typed so far. */
  let typing: { step: Step; name: string; text: string } | null = null;
  /** A drop-down list just clicked, waiting for its choice. */
  let opened: { name: string; index: number } | null = null;
  const at = (l: LogLine) => `at ${(l.t / 1000).toFixed(1)} seconds`;

  const push = (s: Step) => {
    if (chapter) {
      s.chapter = chapter;
      chapter = undefined;
    }
    steps.push(s);
  };
  const endTyping = () => {
    if (!typing) return;
    const t = typing;
    typing = null;
    if (!t.text) return; // A click into a box with nothing typed stays a click.
    t.step.action = "type";
    t.step.value = t.text;
    t.step.narration = say.type(t.name, t.text);
    t.step.expect = `${t.name} reads ${t.text}`;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.type === "window") {
      const ours = l.title.includes(program.windowTitle) || l.process.replace(/\.exe$/i, "").toLowerCase() === program.windowTitle.toLowerCase();
      if (inProgram && !ours) notes.push(`${at(l)}: ${l.process} came in front. What was done there is left out.`);
      inProgram = ours;
      continue;
    }
    if (l.type === "marker") {
      endTyping();
      chapter = l.label.trim().slice(0, 80) || undefined;
      continue;
    }
    if (l.type === "cursorMove" || l.type === "element") continue;
    if (!inProgram) continue;
    if (l.type === "click") {
      endTyping();
      const next = lines[i + 1];
      const element = next?.type === "element" && next.t === l.t ? next : undefined;
      if (l.button !== "left") {
        notes.push(`${at(l)}: a ${l.button} click${element ? ` on "${element.name}"` : ""} is left out (only left clicks can be performed).`);
        continue;
      }
      if (!element) {
        notes.push(`${at(l)}: a click on something without a name (at ${l.x}, ${l.y}) is left out. If it mattered, add the step by hand.`);
        continue;
      }
      const role = studioRole(element.role);
      if (!role) {
        notes.push(`${at(l)}: a click on "${element.name}" (${element.role}) is left out: it is not a control a script can act on.`);
        continue;
      }
      // The choice of a drop-down list just opened.
      if (opened && (role === "listitem" || role === "menuitem") && steps.length - 1 === opened.index) {
        const s = steps[opened.index];
        s.action = "type";
        s.value = element.name;
        s.narration = say.choose(opened.name, element.name);
        s.expect = `${opened.name} is ${element.name}`;
        opened = null;
        continue;
      }
      opened = null;
      const step: Step = { action: "click", fallback: { role, name: element.name }, narration: say.click(element.name, role), expect: `${element.name} was selected` };
      push(step);
      if (role === "combobox") opened = { name: element.name, index: steps.length - 1 };
      if (isTypingBox(role)) typing = { step, name: element.name, text: "" };
      continue;
    }
    if (l.type === "key") {
      if (typing) {
        if (l.key === "backspace" && !l.modifiers.length) {
          typing.text = typing.text.slice(0, -1);
          continue;
        }
        const ch = typedCharacter(l.key, l.modifiers);
        if (ch !== null) {
          typing.text += ch;
          continue;
        }
      }
      const chord = keyChord(l.key, l.modifiers);
      if (!chord) {
        notes.push(`${at(l)}: the key ${[...l.modifiers, l.key].join("+")} is left out: Studio cannot press it.`);
        continue;
      }
      if (/^[A-Z0-9]$/.test(chord) || chord.startsWith("Shift+") && /^Shift\+[A-Z0-9]$/.test(chord)) {
        notes.push(`${at(l)}: "${l.key}" was typed outside a box Studio knows of, and is left out.`);
        continue;
      }
      endTyping();
      push({ action: "key", value: chord, narration: say.key(chord), expect: `${chord} was pressed` });
    }
  }
  endTyping();
  if (!steps.length) throw new Error(`Take ${take.id} has nothing Studio can perform: ${notes.join(" ") || "no clicks on named controls."}`);
  if (steps.length > 200) throw new Error(`Take ${take.id} has ${steps.length} steps; a script holds at most 200. Record it as shorter takes.`);
  const demo = o.demoProject ?? program.demos?.[0]?.name;
  if (!demo) throw new Error(`${program.name} lists no demo projects, so the script cannot say where to start (src/pipeline/programs.ts).`);
  if (!o.demoProject) notes.push(`The video starts in the demo project "${demo}". If the recording started somewhere else, choose that demo project instead.`);
  const title = (o.title ?? r.title ?? "").trim().slice(0, 100) || `${program.name}: recorded steps`;
  const script: Script = {
    format: "openstage-studio-script", version: SCRIPT_VERSION, title,
    goal: (o.goal ?? "").trim() || `You can ${title.charAt(0).toLowerCase()}${title.slice(1)} in ${program.name}.`,
    program: { id: program.id, name: program.name },
    startState: { demoProject: demo, note: `Made by Studio from the recording "${r.title}", take ${take.id}.` },
    writtenBy: { kind: "person", name: "Studio, from a recording", editedByPerson: false },
    steps,
  };
  if (!o.goal) notes.push("The goal was made from the title. Say in one line what the viewer can do after watching.");
  notes.push("The narration says each step plainly. Make it better before the video is made: by hand, or with the AI if one is chosen.");
  return { script, notes, take: take.id, program };
}
