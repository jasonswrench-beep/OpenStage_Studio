// The four AI roles (docs/ai.md): the planner, the scriptwriter, rehearsal repair and the metadata writer. Each turns
// what it is given into a file a person can read and edit; Studio checks every answer before using it. The AI never
// records a take and never approves a video.

import type { Answerer } from "./ask.ts";
import { jsonIn } from "./ask.ts";
import type { ControlFact } from "../pipeline/program-session.ts";
import type { ProgramEntry } from "../pipeline/programs.ts";
import type { Script, Step } from "../script/format.ts";
import { ACTIONS } from "../script/format.ts";

// Shared rules ---------------------------------------------------------------------------------------------------------

const NEVER = "Never name or compare to other companies' products, and never invent people, places or data beyond the demo project's own.";

/** Ask for JSON, check it, and ask again (up to `tries` times) with the problems if it does not pass. */
async function askChecked<T>(a: Answerer, system: string, user: string, check: (v: unknown) => { value?: T; problems: string[] }, tries = 3, maxTokens = 8000): Promise<{ value: T; rounds: number }> {
  let prompt = user;
  let last: string[] = [];
  for (let round = 1; round <= tries; round++) {
    let parsed: unknown;
    try {
      parsed = jsonIn(await a.ask({ system, user: prompt, json: true, maxTokens }));
    } catch (e) {
      last = [e instanceof Error ? e.message : String(e)];
      prompt = `${user}\n\nYour last answer could not be used: ${last.join(" ")} Answer again with the JSON only.`;
      continue;
    }
    const c = check(parsed);
    if (c.value !== undefined && !c.problems.length) return { value: c.value, rounds: round };
    last = c.problems;
    prompt = `${user}\n\nYour last answer was:\n${JSON.stringify(parsed)}\n\nIt has these problems:\n${c.problems.map((p) => `- ${p}`).join("\n")}\n\nAnswer again with the whole corrected JSON only.`;
  }
  throw new Error(`The AI's answer still had problems after ${tries} tries: ${last.join(" ")}`);
}

const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

// The planner ----------------------------------------------------------------------------------------------------------

export interface PlannedVideo {
  /** A short stable name, used for the script's file name. */
  id: string;
  title: string;
  goal: string;
  /** The manual's topics this video teaches. */
  covers: string[];
  position: number;
  /** proposed (the AI's), approved (a person's yes), or cut. */
  status: "proposed" | "approved" | "cut";
}

const PLANNER = `You plan short tutorial videos from one chapter of a software manual.
Make one video for each task the chapter teaches with numbered steps. One task per video. Leave out topics that only describe or explain and have no steps; a chapter with no such tasks gets an empty list of videos.
Each video is two to five minutes long when performed: roughly four to twelve steps.
Put the videos in teaching order, so earlier videos teach what later ones need.
A title is at most 60 characters and names the task, such as "Make a new lesson". A goal is one sentence saying what the viewer can do after watching, starting with "You can".
${NEVER}
Answer with JSON only, in this shape:
{"playlist": "a name for the set of videos", "videos": [{"title": "...", "goal": "...", "covers": ["the manual topic titles it teaches"]}]}`;

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "video";
}

export async function planVideos(a: Answerer, program: ProgramEntry, manualTitle: string, chapterTitle: string, chapterText: string): Promise<{ playlist: string; videos: PlannedVideo[]; rounds: number }> {
  const user = `The program: ${program.name}.\nThe manual: ${manualTitle}. The chapter: ${chapterTitle}.\n\n${chapterText}`;
  const { value, rounds } = await askChecked<{ playlist: string; videos: PlannedVideo[] }>(a, PLANNER, user, (v) => {
    const o = v as { playlist?: unknown; videos?: unknown };
    const problems: string[] = [];
    if (!isText(o.playlist)) problems.push('"playlist" must be a name.');
    // An empty list is a fair answer for a chapter that only explains and has no tasks.
    if (!Array.isArray(o.videos)) problems.push('"videos" must be a list (empty if the chapter has no tasks with steps).');
    const videos: PlannedVideo[] = [];
    const ids = new Set<string>();
    (Array.isArray(o.videos) ? o.videos : []).forEach((x: { title?: unknown; goal?: unknown; covers?: unknown }, i: number) => {
      if (!isText(x.title) || x.title.length > 80) problems.push(`Video ${i + 1} needs a title of at most 60 characters.`);
      if (!isText(x.goal)) problems.push(`Video ${i + 1} needs a goal.`);
      if (!isText(x.title) || !isText(x.goal)) return;
      let id = slug(x.title);
      while (ids.has(id)) id = `${id}-${i + 1}`;
      ids.add(id);
      videos.push({ id, title: x.title.trim(), goal: x.goal.trim(), covers: Array.isArray(x.covers) ? x.covers.filter(isText) : [], position: i + 1, status: "proposed" });
    });
    return { value: problems.length ? undefined : { playlist: String(o.playlist).trim(), videos }, problems };
  });
  return { ...value, rounds };
}

// The scriptwriter -----------------------------------------------------------------------------------------------------

/** The program's controls, one per line, for the AI. */
export function controlLines(controls: ControlFact[], program: ProgramEntry): string {
  const lines = controls.map((c) => `${c.id}: "${c.label.slice(0, 60)}" (${c.role || "control"})${c.shownAtStart ? "" : " [not shown at the start]"}`);
  for (const p of program.appearing ?? []) lines.push(`${p.pattern}: ${p.about} [appears later]`);
  return lines.join("\n");
}

const STEP_RULES = `A step is {"action": ..., "target": ..., "value": ..., "narration": ..., "expect": ...}.
- action is one of: click, type, key, scroll, open, wait.
- click: "target" is the control to click. To choose an item in a list, click the item's control.
- type: "target" is the field, "value" is the text typed. For a drop-down list, "value" is the choice's words, such as "Science".
- Typing adds to the end of words already in a box. To replace a box's words (such as changing a title), first {"action": "key", "target": <the box>, "value": "Ctrl+A"}, then type. To fill a new item's box, type into the new box, not an old one.
- key: "value" is a key or chord such as "Enter", "Tab" or "Ctrl+S"; "target" may name the control.
- scroll: "value" such as "down 300".
- open: "value" is a demo project's name. wait: "value" is seconds.
- target is ALWAYS one of the control names listed below, exactly as written (or a numbered name for a control that appears later). Never a visible label.
- A menu's items are clicked only after the menu itself is clicked. A dialog's controls are used only after the control that opens it is clicked.
- narration: one or two short sentences, spoken while the step happens, saying what to do and why, to "you". Name controls by their words on screen.
- expect: what is true on screen after the step, in a few words.`;

const WRITER = `You write tutorial scripts: a script is a plain JSON file a player performs in the real program, step by step, while a voice reads the narration.
${STEP_RULES}
The script also has: "title" (the video's title), "goal", "startState": {"demoProject": one of the demo projects listed}, "intro" (one or two sentences for the title card) and "outro" (one sentence for the end card).
Write only the steps the task needs, in order, starting from the demo project as it opens. ${NEVER}
Answer with JSON only:
{"title": "...", "goal": "...", "startState": {"demoProject": "..."}, "intro": "...", "outro": "...", "steps": [ ... ]}
An example of steps:
[{"action": "click", "target": "toolbar.new", "narration": "Select New on the toolbar to start a blank item.", "expect": "A blank item is open"},
 {"action": "type", "target": "editor.name", "value": "Field trip", "narration": "Type a name for it.", "expect": "The name reads Field trip"}]`;

export interface WriterInput {
  program: ProgramEntry;
  video: PlannedVideo;
  /** The manual's words for the topics the video covers. */
  manualText: string;
  controls: ControlFact[];
  /** Check a script against the format and the program's controls; returns the problems in words. */
  check: (s: Script) => string[];
}

function demoLines(p: ProgramEntry): string {
  return (p.demos ?? []).map((d) => `${d.name}: ${d.about}`).join("\n") || "(none listed)";
}

export async function writeScript(a: Answerer, w: WriterInput): Promise<{ script: Script; rounds: number }> {
  const user = [
    `The program: ${w.program.name}.`,
    `The video: "${w.video.title}". Goal: ${w.video.goal}`,
    w.program.notes ? `About the program: ${w.program.notes}` : "",
    `Demo projects:\n${demoLines(w.program)}`,
    `The controls (name: words on screen (role)):\n${controlLines(w.controls, w.program)}`,
    `What the manual says about this task:\n${w.manualText}`,
  ].filter(Boolean).join("\n\n");
  const { value, rounds } = await askChecked<Script>(a, WRITER, user, (v) => {
    const o = v as Record<string, unknown>;
    const script = {
      format: "openstage-studio-script", version: 2,
      title: o.title, goal: o.goal,
      program: { id: w.program.id, name: w.program.name },
      driver: "hook",
      startState: o.startState,
      ...(isText(o.intro) ? { intro: o.intro } : {}),
      ...(isText(o.outro) ? { outro: o.outro } : {}),
      steps: Array.isArray(o.steps) ? collapseRepeats(o.steps.map(cleanStep)) : o.steps,
    } as unknown as Script;
    const problems = w.check(script);
    return { value: problems.length ? undefined : script, problems };
  }, 4, 12000);
  return { script: value, rounds };
}

/** Remove a step that exactly repeats the one before it (same action, control and value): a slip, often where a repair
 * joins the script. Keys and scrolls may repeat on purpose and are kept. */
export function collapseRepeats(steps: Step[]): Step[] {
  return steps.filter((s, i) => {
    const p = steps[i - 1];
    return !(p && s.action !== "key" && s.action !== "scroll" && p.action === s.action && p.target === s.target && p.value === s.value);
  });
}

/** Keep only a step's known fields, so a stray field from the AI does not fail the check. */
export function cleanStep(s: unknown): Step {
  const o = (s ?? {}) as Record<string, unknown>;
  const step: Record<string, unknown> = {};
  for (const k of ["action", "target", "value", "narration", "expect", "chapter", "silent", "hold", "callout", "highlight"]) if (o[k] !== undefined && o[k] !== null && o[k] !== "") step[k] = o[k];
  if (typeof step.value === "number") step.value = String(step.value);
  if (typeof step.action === "string") step.action = step.action.toLowerCase();
  if (!(ACTIONS as readonly unknown[]).includes(step.action)) step.action = String(step.action ?? "");
  return step as unknown as Step;
}

// Rehearsal repair -----------------------------------------------------------------------------------------------------

const REPAIR = `You repair a tutorial script that failed in rehearsal. The player performs the steps in the real program; one step could not be performed.
You are told the steps, which one failed and why, the controls on screen at that moment, and the text on screen.
Fix it by replacing a run of steps that includes the failed step: from step "from" (the failed step, or an earlier one if an earlier step caused the problem) to step "to" (the failed step, or a later one if later steps have the same problem, such as a renamed control used again).
Common causes: a menu or dialog was not opened first; a control is only shown after another step; the wrong item was clicked; a value does not match a list's choices; a new version of the program renamed a control.
${STEP_RULES}
Keep the narration's meaning, and change narration only where the words on screen changed. ${NEVER}
If an answer comes back with problems, "steps[i]" in them counts from 0 (steps[0] is step 1).
Answer with JSON only: {"why": "what went wrong, in one sentence", "from": <step number>, "to": <step number>, "steps": [the new steps that replace steps "from" to "to"]}`;

export interface RepairInput {
  program: ProgramEntry;
  script: Script;
  /** The failed step's index (from 0). */
  failed: number;
  error: string;
  controlsNow: ControlFact[];
  textNow: string[];
  allControls: ControlFact[];
  picture?: Buffer;
  check: (s: Script) => string[];
}

export async function repairStep(a: Answerer, r: RepairInput): Promise<{ script: Script; why: string; from: number; to: number; rounds: number }> {
  const numbered = r.script.steps.map((s, i) => `${i + 1}. ${JSON.stringify(s)}`).join("\n");
  const shown = r.controlsNow.filter((c) => c.shownAtStart).map((c) => `${c.id}: "${c.label.slice(0, 60)}" (${c.role || "control"})`).join("\n");
  const user = [
    `The program: ${r.program.name}.${r.program.notes ? ` ${r.program.notes}` : ""}`,
    `The script starts from the demo project "${r.script.startState.demoProject}". Its steps:\n${numbered}`,
    `Step ${r.failed + 1} failed: ${r.error}`,
    `The controls on screen when it failed:\n${shown || "(none)"}`,
    `The text on screen when it failed:\n${r.textNow.slice(0, 80).join("\n")}`,
    `Every control the program has:\n${controlLines(r.allControls, r.program)}`,
  ].join("\n\n");
  const { value, rounds } = await askChecked<{ script: Script; why: string; from: number; to: number }>(a, REPAIR, user, (v) => {
    const o = v as { why?: unknown; from?: unknown; to?: unknown; steps?: unknown };
    const problems: string[] = [];
    const from = Number(o.from ?? r.failed + 1);
    const to = Number(o.to ?? r.failed + 1);
    const n = r.script.steps.length;
    if (!Number.isInteger(from) || from < 1 || from > r.failed + 1) problems.push(`"from" must be a step number from 1 to ${r.failed + 1}.`);
    if (!Number.isInteger(to) || to < r.failed + 1 || to > n) problems.push(`"to" must be a step number from ${r.failed + 1} to ${n}.`);
    const most = Math.max(8, (Number.isInteger(to) ? to : r.failed + 1) - (Number.isInteger(from) ? from : r.failed + 1) + 4);
    if (!Array.isArray(o.steps) || !o.steps.length || o.steps.length > most) problems.push(`"steps" must list one to ${most} steps.`);
    if (problems.length) return { problems };
    const steps = collapseRepeats([...r.script.steps.slice(0, from - 1), ...(o.steps as unknown[]).map(cleanStep), ...r.script.steps.slice(to)]);
    const script = { ...r.script, steps };
    problems.push(...r.check(script));
    return { value: problems.length ? undefined : { script, why: isText(o.why) ? o.why : "", from, to }, problems };
  }, 3);
  void r.picture;
  return { ...value, rounds };
}

/** Repair with a picture of the demo workspace, for services that can see. */
export async function repairWithPicture(a: Answerer, r: RepairInput) {
  if (!a.pictures || !r.picture) return repairStep(a, r);
  const pictured: Answerer = { ...a, ask: (q) => a.ask({ ...q, pictures: [r.picture!] }) };
  return repairStep(pictured, r);
}

// The metadata writer --------------------------------------------------------------------------------------------------

/** Scripts shorter than this get no chapters: video sites want three chapters of ten seconds or more. */
const CHAPTER_STEPS = 8;

const METADATA = `You write the publishing details for a finished tutorial video, from its script.
- "description": two to four plain sentences saying what the video teaches and who it is for. Name the program by its name as given; say only what the steps show.
- "tags": five to ten short tags, lower case, about the program and the task.
- "chapters": for a script of ${CHAPTER_STEPS} steps or more, three to six chapters, each {"step": the step number it starts at, "name": a short name}, the first at step 1, each at least two steps after the one before. For a shorter script, an empty list.
${NEVER}
Answer with JSON only: {"description": "...", "tags": ["..."], "chapters": [{"step": 1, "name": "..."}]}`;

export async function writeMetadata(a: Answerer, script: Script): Promise<{ script: Script; rounds: number }> {
  const user = `The program: ${script.program.name}.\nThe video: "${script.title}". Goal: ${script.goal}\nThe steps:\n${script.steps.map((s, i) => `${i + 1}. ${s.narration ?? ""}`).join("\n")}`;
  const n = script.steps.length;
  const { value, rounds } = await askChecked<Script>(a, METADATA, user, (v) => {
    const o = v as { description?: unknown; tags?: unknown; chapters?: unknown };
    const problems: string[] = [];
    if (!isText(o.description)) problems.push('"description" must be some sentences.');
    const tags = Array.isArray(o.tags) ? o.tags.filter(isText).map((t) => t.trim().toLowerCase()).slice(0, 10) : [];
    if (tags.length < 3) problems.push('"tags" must list at least three tags.');
    const chapters = (Array.isArray(o.chapters) ? o.chapters : []).map((c: { step?: unknown; name?: unknown }) => ({ step: Number(c.step), name: c.name }));
    const good = n < CHAPTER_STEPS ? [] : chapters.filter((c) => Number.isInteger(c.step) && c.step >= 1 && c.step <= n && isText(c.name)).sort((p, q) => p.step - q.step);
    if (good.length) good[0].step = 1;
    // Keep chapters at least two steps apart, and at most six.
    const unique: typeof good = [];
    for (const c of good) if (!unique.length || c.step - unique[unique.length - 1].step >= 2) unique.push(c);
    unique.splice(6);
    if (n >= CHAPTER_STEPS && unique.length < 3) problems.push(`"chapters" must list three to six chapters at steps from 1 to ${n}, each at least two steps after the one before.`);
    if (problems.length) return { problems };
    const steps = script.steps.map((s, i) => {
      const { chapter: _old, ...rest } = s;
      void _old;
      const c = unique.find((x) => x.step === i + 1);
      return c ? { ...rest, chapter: String(c.name).trim().slice(0, 60) } : rest;
    });
    return { value: { ...script, steps: steps as Step[], publish: { ...script.publish, description: String(o.description).trim(), tags } }, problems };
  });
  return { script: value, rounds };
}
