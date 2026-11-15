// The programs Studio knows how to start in demo mode. Each entry says how to launch it with the demo flag and how to
// find its window. A program joins this list once it includes the demo-mode hook (docs/demo-hook.md).

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readStudioSettings, studioExe, workspace as studioWorkspace } from "../paths.ts";

/** OpenStage Author's program: where OPENSTAGE_AUTHOR_EXE or Studio's Settings say, else a build in Author's repository
 * beside this one (which has the demo hook), else its usual per-user install. Null if none is there. */
export function authorExe(root: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const local = env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const places = [
    env.OPENSTAGE_AUTHOR_EXE,
    readStudioSettings().authorExe,
    resolve(root, "../openstage-author/editor/src-tauri/target/release/openstage-editor.exe"),
    join(local, "OpenStage Author", "openstage-editor.exe"),
  ];
  return places.find((p): p is string => !!p && existsSync(p)) ?? null;
}

export interface ProgramEntry {
  id: string;
  name: string;
  /** The program and its arguments, given the hook's address and token and the display to use. */
  launch(root: string, endpoint: string, token: string, monitor: number): { exe: string; args: string[] };
  /** Part of the program window's title, or its program file's name, to find the window to record. */
  windowTitle: string;
  /** The demo projects a script may open, with what each holds, for the AI scriptwriter (and people). */
  demos?: { name: string; about: string }[];
  /** Controls that exist only after an action, named with * for their number, such as a list's items. A script may
   * name them even though they are not in the control list at the start. */
  appearing?: { pattern: string; about: string }[];
  /** Anything else a scriptwriter needs to know about driving the program. */
  notes?: string;
  /** For the accessibility driver (no hook): the program and its arguments to start it with a demo project open on the
   * given display. A program without this can only be driven through its hook. */
  launchPlain?(root: string, monitor: number, demo: string): { exe: string; args: string[] };
}

export const PROGRAMS: ProgramEntry[] = [
  {
    id: "practice-planner",
    name: "Practice Planner",
    launch(_root, endpoint, token, monitor) {
      const exe = studioExe();
      if (!existsSync(exe)) throw new Error(`OpenStage Studio is not built yet (${exe}). Run "Build Studio.bat" first.`);
      // PRACTICE_PLANNER_VERSION=2 runs the version with a changed interface, for the release check's acceptance test.
      const version = /^[0-9]{1,2}$/.test(process.env.PRACTICE_PLANNER_VERSION ?? "") ? ["--sample-version", process.env.PRACTICE_PLANNER_VERSION!] : [];
      return { exe, args: ["--sample-program", "--demo-hook", endpoint, "--demo-token", token, "--monitor", String(monitor), ...version] };
    },
    launchPlain(_root, monitor, demo) {
      const exe = studioExe();
      if (!existsSync(exe)) throw new Error(`OpenStage Studio is not built yet (${exe}). Run "Build Studio.bat" first.`);
      return { exe, args: ["--sample-program", "--monitor", String(monitor), "--open-demo", demo] };
    },
    windowTitle: "Practice Planner (OpenStage Studio sample program)",
    demos: [
      { name: "demo-lessons-01", about: "Spring term lessons: twelve invented lessons in the list on the left, none selected yet." },
      { name: "demo-empty", about: "An empty planner with no lessons." },
    ],
    appearing: [
      { pattern: "sidebar.lesson.*", about: "lesson number * in the list on the left, counting from 1 at the top; a new lesson is added at the end, and a copy just under the lesson it copies" },
      { pattern: "editor.checklist.item.*", about: "the box for item number * under Things to bring; Add item adds a new box after the lesson's existing items, so the new box's number is one more than the items it already has" },
    ],
    notes: "The editor on the right shows its controls only once a lesson is selected or a new one is made. Typing into the Subject or Length list chooses the choice with those words, such as \"Science\" or \"30 minutes\". The Insert menu's items show only after Insert is clicked, and the Lesson settings dialog's controls only after Lesson settings is clicked; OK closes the dialog. New lesson and Duplicate each open the new lesson in the editor at once, so it is not clicked in the list afterward (clicking another lesson would edit that one instead). Ctrl+S saves, as Save lesson does.",
  },
  {
    id: "openstage-author",
    name: "OpenStage Author",
    launch(root, endpoint, token, monitor) {
      // Author's editor, built from its own repository beside this one, or wherever OPENSTAGE_AUTHOR_EXE says.
      const exe = authorExe(root);
      if (!exe) throw new Error("OpenStage Author was not found. Install it, or say where its program is in Studio's Settings (or set OPENSTAGE_AUTHOR_EXE).");
      // A clean folder for the demo courses of this take, always at the same place, so two takes look the same.
      const workspace = resolve(studioWorkspace(), "work", "demo-workspace", "openstage-author");
      rmSync(workspace, { recursive: true, force: true });
      mkdirSync(workspace, { recursive: true });
      return { exe, args: ["--demo-hook", endpoint, "--demo-token", token, "--demo-workspace", workspace, "--monitor", String(monitor)] };
    },
    windowTitle: "openstage-editor",
  },
];

/**
 * The environment a program is started with in demo mode. Its browser engine is told to draw all text with plain grey
 * smoothing, never the coloured kind: the coloured kind can switch on or off for a label next to a control drawn in its
 * own layer, depending on timing, which made two takes differ (2026-11-15). Grey smoothing also suits video better, as
 * coloured fringes do not survive compression. The engine's own default options are kept, since this setting replaces
 * them.
 *
 * It also draws everything in software, never on the graphics card: the engine starts drawing in software and moves to
 * the graphics card once that is ready, and the two smooth curved edges one level of brightness apart, so when the move
 * happened (timing again) decided which pictures had which corners. Seen on 2026-11-15, when the practice program got a
 * browser-engine data folder of its own: the same take moved at step 4, at no step, or at step 11.
 */
export function demoEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-lcd-text --disable-gpu" };
}

export function findProgram(id: string): ProgramEntry {
  const p = PROGRAMS.find((x) => x.id === id);
  if (!p) {
    throw new Error(`Studio does not know how to start "${id}" in demo mode yet. Known programs: ${PROGRAMS.map((x) => x.id).join(", ")}. See docs/demo-hook.md for adding one.`);
  }
  return p;
}
