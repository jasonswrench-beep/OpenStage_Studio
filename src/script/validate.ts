// The script validator: rejects a malformed script before the player runs it, and says in words what is wrong and where.
// Errors stop a script from being recorded. Warnings do not; they point at things a person should look at.

import {
  ACTIONS, DRIVERS, parseKey, parseScroll, SCRIPT_FORMAT, SCRIPT_VERSION, type Script,
} from "./format.ts";
import { migrateScript } from "./migrate.ts";

export interface Problem {
  /** Where in the script, such as `steps[3].target`. */
  path: string;
  message: string;
}

export interface Validation {
  ok: boolean;
  errors: Problem[];
  warnings: Problem[];
  /** Whether every step says what must be true afterward, so the script can count as rehearsed. */
  rehearsable: boolean;
  /** The script, typed, when there are no errors. */
  script?: Script;
}

export interface ValidateOptions {
  /** The program's real control names from the demo-mode hook. When given, any target not in the list is an error. */
  controls?: readonly string[];
  /** Controls that appear only after an action, with * for their number (such as `sidebar.lesson.*`); they count as real. */
  controlPatterns?: readonly string[];
}

/** Whether a control name fits a pattern such as `sidebar.lesson.*`, where * is a number. */
export function fitsPattern(name: string, pattern: string): boolean {
  const parts = pattern.split("*");
  if (parts.length !== 2) return name === pattern;
  const [head, tail] = parts;
  return name.length > head.length + tail.length && name.startsWith(head) && name.endsWith(tail)
    && /^[0-9]{1,4}$/.test(name.slice(head.length, name.length - tail.length));
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const CONTROL = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
const COLOUR = /^#[0-9A-Fa-f]{6}$/;
const SIDES = ["left", "right", "above", "below"];

const HEADER_KEYS = ["format", "version", "title", "goal", "program", "driver", "startState", "playlist", "intro", "outro", "writtenBy", "publish", "redactions", "steps"];
const STEP_KEYS = ["action", "target", "fallback", "value", "narration", "silent", "callout", "highlight", "hold", "expect", "chapter", "describe"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Looks like a file path or a drive: a slash, a backslash, a colon, or a leading dot or tilde. */
export function looksLikePath(text: string): boolean {
  return /[\\/:]/.test(text) || /^[.~]/.test(text);
}

/** How many sentences a piece of narration has. */
export function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== "").length;
}

export function validateScript(input: unknown, options: ValidateOptions = {}): Validation {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const warn = (path: string, message: string) => warnings.push({ path, message });
  const controls = options.controls ? new Set(options.controls) : null;

  const checkControl = (path: string, value: unknown) => {
    if (!isText(value)) return err(path, "Name a control by its stable name, such as toolbar.insert.textbox.");
    if (!CONTROL.test(value)) return err(path, `"${value}" is not a control name. Use letters, digits, - and _, in parts joined by dots.`);
    if (controls && !controls.has(value) && !(options.controlPatterns ?? []).some((p) => fitsPattern(value, p))) err(path, `The program has no control called "${value}".`);
  };
  const unknownKeys = (obj: Obj, allowed: string[], path: string) => {
    for (const key of Object.keys(obj)) if (!allowed.includes(key)) err(path ? `${path}.${key}` : key, `"${key}" is not part of a script here. Check the spelling.`);
  };

  if (!isObj(input)) {
    err("", "A script is a JSON object with a title, a goal, a program, a starting state and a list of steps.");
    return { ok: false, errors, warnings, rehearsable: false };
  }
  const migrated = migrateScript(input);
  const s = migrated.data as Obj;
  if (migrated.from !== undefined) warn("version", `This script is version ${migrated.from} and was read as version ${SCRIPT_VERSION}. ${migrated.notes.join(" ")}`);
  unknownKeys(s, HEADER_KEYS, "");
  if (s.format !== SCRIPT_FORMAT) err("format", `The format must be "${SCRIPT_FORMAT}".`);
  if (s.version !== SCRIPT_VERSION) {
    err("version", typeof s.version === "number" && s.version > SCRIPT_VERSION
      ? `This script is version ${s.version}, made by a newer OpenStage Studio. This one reads version ${SCRIPT_VERSION}.`
      : `The version must be ${SCRIPT_VERSION}.`);
  }
  if (!isText(s.title)) err("title", "Give the video a title.");
  else if (s.title.length > 100) err("title", "The title is longer than 100 characters, which is too long for a title card.");
  if (!isText(s.goal)) err("goal", "Give the video a one-line goal: what the viewer can do after watching.");

  if (!isObj(s.program)) err("program", "Say which program the video is about: an id and a name.");
  else {
    unknownKeys(s.program, ["id", "name", "version"], "program");
    if (!isText(s.program.id) || !SLUG.test(s.program.id)) err("program.id", "The program's id is a short name in lower case letters, digits and hyphens.");
    if (!isText(s.program.name)) err("program.name", "Give the program's name as viewers see it.");
    if (s.program.version !== undefined && !isText(s.program.version)) err("program.version", "The version is text, such as 1.2.");
  }
  if (s.driver !== undefined) {
    if (!(DRIVERS as readonly unknown[]).includes(s.driver)) err("driver", `The driver is one of ${DRIVERS.join(", ")}.`);
    else if (s.driver === "position") err("driver", "The position driver is not built yet. Use the hook or the accessibility driver.");
  }
  if (!isObj(s.startState)) err("startState", "Name the demo project the video starts from, as startState.demoProject.");
  else {
    unknownKeys(s.startState, ["demoProject", "note"], "startState");
    const p = s.startState.demoProject;
    if (!isText(p)) err("startState.demoProject", "Name the demo project the video starts from.");
    else if (looksLikePath(p)) err("startState.demoProject", "This looks like a file path. Name a demo project from the program's demo library instead, so no real file can appear on screen.");
    else if (!SLUG.test(p)) err("startState.demoProject", "A demo project's name is lower case letters, digits and hyphens.");
    if (s.startState.note !== undefined && typeof s.startState.note !== "string") err("startState.note", "The note is text.");
  }
  if (s.playlist !== undefined) {
    if (!isObj(s.playlist)) err("playlist", "The playlist has a name and a position.");
    else {
      unknownKeys(s.playlist, ["name", "position"], "playlist");
      if (!isText(s.playlist.name)) err("playlist.name", "Give the playlist's name.");
      if (!Number.isInteger(s.playlist.position) || (s.playlist.position as number) < 1) err("playlist.position", "The position is a whole number from 1.");
    }
  }
  for (const key of ["intro", "outro"] as const) {
    if (s[key] !== undefined && !isText(s[key])) err(key, `The ${key} is narration text; leave it out for none.`);
  }
  if (s.writtenBy !== undefined) {
    const w = s.writtenBy;
    if (!isObj(w) || (w.kind !== "person" && w.kind !== "model")) err("writtenBy", 'writtenBy.kind is "person" or "model".');
    else unknownKeys(w, ["kind", "name", "editedByPerson"], "writtenBy");
  }
  const stepCount = Array.isArray(s.steps) ? s.steps.length : 0;
  if (s.publish !== undefined) {
    const p = s.publish;
    if (!isObj(p)) err("publish", "publish is an object with a description, tags and a thumbnail step.");
    else {
      unknownKeys(p, ["description", "tags", "thumbnailStep"], "publish");
      if (p.description !== undefined && !isText(p.description)) err("publish.description", "The description is text.");
      else if (isText(p.description) && p.description.length > 4000) warn("publish.description", "The description is long; video sites allow about 5,000 characters, and the chapter list is added to it.");
      if (p.tags !== undefined) {
        if (!Array.isArray(p.tags) || !p.tags.every(isText)) err("publish.tags", "The tags are a list of words or short phrases.");
        else if (p.tags.join(",").length > 450) warn("publish.tags", "The tags add up to more than video sites usually allow (about 500 characters).");
      }
      if (p.thumbnailStep !== undefined && !(Number.isInteger(p.thumbnailStep) && (p.thumbnailStep as number) >= 1 && (p.thumbnailStep as number) <= stepCount)) {
        err("publish.thumbnailStep", `The thumbnail step is a step number from 1 to ${stepCount}.`);
      }
    }
  }
  if (s.redactions !== undefined) {
    if (!Array.isArray(s.redactions)) err("redactions", "redactions is a list of blurred boxes.");
    else s.redactions.forEach((r: unknown, i: number) => {
      const at = `redactions[${i}]`;
      if (!isObj(r)) return err(at, "A blurred box has a box, a first step and a last step.");
      unknownKeys(r, ["box", "fromStep", "toStep", "reason"], at);
      const b = r.box;
      if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => typeof n === "number" && Number.isFinite(n))) err(`${at}.box`, "The box is four numbers: left, top, width and height, in pixels of the 1920 by 1080 video.");
      else {
        const [x, y, w, h] = b as number[];
        if (w <= 0 || h <= 0) err(`${at}.box`, "The box needs a width and a height.");
        else if (x < 0 || y < 0 || x + w > 1920 || y + h > 1080) err(`${at}.box`, "The box goes outside the 1920 by 1080 picture.");
      }
      const from = r.fromStep, to = r.toStep;
      if (!Number.isInteger(from) || (from as number) < 0 || (from as number) > stepCount) err(`${at}.fromStep`, `The first step is a step number from 1 to ${stepCount}, or 0 for the starting picture.`);
      if (!Number.isInteger(to) || (to as number) < 0 || (to as number) > stepCount) err(`${at}.toStep`, `The last step is a step number from 1 to ${stepCount}, or 0 for the starting picture.`);
      else if (Number.isInteger(from) && (to as number) < (from as number)) err(`${at}.toStep`, "The last step comes before the first.");
      if (r.reason !== undefined && typeof r.reason !== "string") err(`${at}.reason`, "The reason is text.");
    });
  }

  let rehearsable = true;
  const accessible = s.driver === "accessibility";
  if (!Array.isArray(s.steps) || s.steps.length === 0) err("steps", "A script needs at least one step.");
  else if (s.steps.length > 200) err("steps", "A script has at most 200 steps. Split a long task into more than one video.");
  else {
    s.steps.forEach((step: unknown, i: number) => {
      const at = `steps[${i}]`;
      if (!isObj(step)) return err(at, "Each step is an object with an action.");
      unknownKeys(step, STEP_KEYS, at);
      const action = step.action;
      if (!(ACTIONS as readonly unknown[]).includes(action)) return err(`${at}.action`, `The action is one of ${ACTIONS.join(", ")}.`);
      const needsTarget = action === "click" || action === "drag";
      // The accessibility driver may find a control with no automation id by its role and name instead (fallback).
      const byName = accessible && isObj(step.fallback) && isText(step.fallback.name);
      if (accessible && !["click", "type", "wait"].includes(action as string)) {
        err(`${at}.action`, `The accessibility driver does ${action === "key" || action === "scroll" ? "not press keys or scroll (it never uses the real keyboard or mouse)" : action === "open" ? "not open another demo project partway (the program starts with the script's demo project)" : "not do this"}. Use click, type and wait, or the hook.`);
      }
      if ((needsTarget && !(byName && step.target === undefined)) || (step.target !== undefined && action !== "open" && action !== "wait")) checkControl(`${at}.target`, step.target);
      if ((action === "open" || action === "wait") && step.target !== undefined) err(`${at}.target`, `A ${action} step has no target.`);
      const value = step.value;
      if (value !== undefined && typeof value !== "string") err(`${at}.value`, "The value is text.");
      switch (action) {
        case "drag":
          err(`${at}.action`, "Drag is not performed in this version. Canvas actions will get their own hook commands later.");
          break;
        case "type":
          if (!isText(value)) err(`${at}.value`, "Say what to type.");
          else if (value.length > 500) err(`${at}.value`, "Type at most 500 characters in one step.");
          break;
        case "key":
          if (!isText(value) || !parseKey(value)) err(`${at}.value`, "Say which key to press, such as Enter, Tab, Ctrl+S or Shift+Tab.");
          break;
        case "open":
          if (!isText(value)) err(`${at}.value`, "Name the demo project to open.");
          else if (looksLikePath(value)) err(`${at}.value`, "This looks like a file path. Open a demo project by name instead.");
          else if (!SLUG.test(value)) err(`${at}.value`, "A demo project's name is lower case letters, digits and hyphens.");
          break;
        case "scroll":
          if (!parseScroll(value as string | undefined)) err(`${at}.value`, "Say which way and how far to scroll, such as down 300.");
          break;
        case "wait":
          if (value !== undefined && !(Number(value) > 0 && Number(value) <= 30)) err(`${at}.value`, "Wait between 0 and 30 seconds.");
          break;
      }
      if (step.fallback !== undefined) {
        const f = step.fallback;
        if (!isObj(f)) err(`${at}.fallback`, "The fallback is an object with a role and name, or x and y.");
        else {
          unknownKeys(f, ["role", "name", "x", "y"], `${at}.fallback`);
          for (const k of ["x", "y"] as const) {
            if (f[k] !== undefined && !(typeof f[k] === "number" && (f[k] as number) >= 0 && (f[k] as number) <= 1)) err(`${at}.fallback.${k}`, `${k} is a share of the window, from 0 to 1.`);
          }
        }
      }
      // Narration: every step speaks or is silent on purpose, so no dead air slips in.
      const narration = step.narration;
      if (step.silent !== undefined && typeof step.silent !== "boolean") err(`${at}.silent`, "silent is true or false.");
      if (narration !== undefined && !isText(narration)) err(`${at}.narration`, "The narration is text. Leave it out and set silent to true for a step with none.");
      if (isText(narration) && step.silent === true) err(`${at}`, "This step has narration and is also marked silent. Keep one.");
      if (narration === undefined && step.silent !== true) err(`${at}.narration`, "This step has no narration. Write one or two sentences, or set silent to true if it is meant to be quiet.");
      if (isText(narration)) {
        if (sentenceCount(narration) > 2) warn(`${at}.narration`, "Narration is one or two sentences a step. Split this step, or shorten it.");
        if (narration.length > 280) warn(`${at}.narration`, "This narration is long for one step.");
      }
      if (step.highlight !== undefined && typeof step.highlight !== "boolean") err(`${at}.highlight`, "highlight is true or false.");
      if (step.hold !== undefined && !(typeof step.hold === "number" && step.hold >= 0 && step.hold <= 10)) err(`${at}.hold`, "hold is a number of seconds from 0 to 10.");
      if (step.expect !== undefined && !isText(step.expect)) err(`${at}.expect`, "expect says in words what must be true after the step.");
      if (!isText(step.expect)) rehearsable = false;
      if (step.chapter !== undefined && !isText(step.chapter)) err(`${at}.chapter`, "A chapter has a name.");
      if (step.describe !== undefined) {
        if (!isText(step.describe)) err(`${at}.describe`, "A description is words: what the step shows that the narration does not say.");
        else if (step.describe.length > 280) err(`${at}.describe`, "A description is at most 280 characters; a player reads it while the step is on screen.");
      }
      if (step.callout !== undefined) {
        const c = step.callout;
        const cp = `${at}.callout`;
        if (!isObj(c)) err(cp, "A callout is an object with a type: box, arrow or label.");
        else {
          if (c.color !== undefined && !(typeof c.color === "string" && COLOUR.test(c.color))) err(`${cp}.color`, "A colour is written as # and six hex digits, such as #E0182D.");
          if (c.type === "box") {
            unknownKeys(c, ["type", "around", "color"], cp);
            checkControl(`${cp}.around`, c.around);
          } else if (c.type === "arrow") {
            unknownKeys(c, ["type", "to", "from", "color"], cp);
            checkControl(`${cp}.to`, c.to);
            if (c.from !== undefined && !SIDES.includes(c.from as string)) err(`${cp}.from`, `from is one of ${SIDES.join(", ")}.`);
          } else if (c.type === "label") {
            unknownKeys(c, ["type", "text", "near", "side", "color"], cp);
            if (!isText(c.text)) err(`${cp}.text`, "Give the label's words.");
            else if (c.text.length > 60) err(`${cp}.text`, "A label is at most 60 characters, so it can be read in passing.");
            checkControl(`${cp}.near`, c.near);
            if (c.side !== undefined && !SIDES.includes(c.side as string)) err(`${cp}.side`, `side is one of ${SIDES.join(", ")}.`);
          } else err(`${cp}.type`, "A callout's type is box, arrow or label.");
        }
      }
    });
  }
  const ok = errors.length === 0;
  return { ok, errors, warnings, rehearsable: ok && rehearsable, script: ok ? (s as unknown as Script) : undefined };
}

/** The problems as lines for a person to read. */
export function describeProblems(v: Validation): string[] {
  const line = (kind: string, p: Problem) => `${kind}${p.path ? ` at ${p.path}` : ""}: ${p.message}`;
  return [...v.errors.map((p) => line("Error", p)), ...v.warnings.map((p) => line("Warning", p))];
}
