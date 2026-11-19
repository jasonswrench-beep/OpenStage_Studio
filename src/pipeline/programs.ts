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

/** OpenStage Guide's window with the demo hook: where OPENSTAGE_GUIDE_EXE says, else a build of Guide's branch
 * `studio-demo-hook` beside this repository (its own checkout, OpenStageGuide-demo, or Guide's main checkout when that branch is
 * there). The installed Guide has no hook yet, so it is never used. Null if none is there. */
export function guideExe(root: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const build = "shell/src-tauri/target/release/openstage-guide-shell.exe";
  const places = [env.OPENSTAGE_GUIDE_EXE, resolve(root, "../OpenStageGuide-demo", build), resolve(root, "../OpenStageGuide", build)];
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
  {
    id: "openstage-guide",
    name: "OpenStage Guide",
    launch(root, endpoint, token, monitor) {
      const exe = guideExe(root);
      if (!exe) throw new Error("OpenStage Guide with the demo hook was not found. Build the window of Guide's branch studio-demo-hook (in its shell folder: npm run build:exe), or set OPENSTAGE_GUIDE_EXE.");
      // A clean guides folder for this take, always at the same place, so two takes look the same. Guide copies a demo guide into it when
      // a script opens one, and never touches the person's own guides in demo mode.
      const workspace = resolve(studioWorkspace(), "work", "demo-workspace", "openstage-guide");
      rmSync(workspace, { recursive: true, force: true });
      mkdirSync(workspace, { recursive: true });
      return { exe, args: ["--demo-hook", endpoint, "--demo-token", token, "--demo-workspace", workspace, "--monitor", String(monitor)] };
    },
    windowTitle: "OpenStage Guide (demo mode)",
    demos: [
      { name: "giving-feedback", about: "Giving Feedback: a workshop for new team leads, the program manual's own made-up workshop: three modules, seven lessons of 15, 20, 25, 15, 35, 15 and 5 minutes (130 in all), blocks of many kinds, Handout 2.1: Feedback planning sheet, the facilitator-only Form 2.2: Observer notes for the practice rounds, and a four-question Level Two quiz. It opens as the guide called Giving Feedback." },
    ],
    appearing: [
      { pattern: "dialog.ok", about: "the main button of the dialog that is open, whatever its words (Create, Open, OK)" },
      { pattern: "dialog.cancel", about: "the Cancel button of the dialog that is open" },
      { pattern: "dialog.close", about: "the Close button of the window that is open: a dialog's X, the Keyboard keys window's Close, the command search's X" },
      { pattern: "dialog.name", about: "the name box of the New guide dialog" },
      { pattern: "page.welcome-new", about: "New guide... on the welcome page, shown when no guide is open (after File > Close guide)" },
      { pattern: "page.welcome-open", about: "Open guide... on the welcome page" },
      { pattern: "welcome.guide.giving-feedback", about: "the Giving Feedback guide in the card Your guides on the welcome page; a click opens it" },
      { pattern: "dialog.guide.giving-feedback", about: "Giving Feedback in the list of the Open guide window" },
      { pattern: "page.cs-input", about: "the box of Search for a command, once it is open (bar.search or Ctrl+K)" },
      { pattern: "page.cs-opt-*", about: "the command numbered * in the list Search for a command shows, counting from 0 at the top" },
    ],
    notes: "The welcome page shows first. A menu's commands show only after its name is clicked (menu.file, menu.edit and the rest); a command is menu.<menu>.<command>, such as menu.file.newGuide or menu.help.about. The buttons on the navy bar while a guide is open are bar.reviewGuide, bar.updateGuide and bar.participantWorkbook; bar.search opens the command search. bar.name and bar.saved are the guide's name and the saved word on the navy bar: words to point a callout at, not to click. A callout on the navy bar needs a light color, such as #FFD23F, to be seen. A dialog's buttons are dialog.ok (its main button, whatever its words), dialog.cancel and dialog.close. Opening a demo guide shows the guide on the left and the tools pane on the right. In demo mode the tools pane's controls are pane.<id> and other page controls page.<id>; a dialog's boxes are dialog.name and dialog.field.<field>, its choices dialog.guide.<guide> and dialog.choice.<choice>, and a guide on the welcome page welcome.guide.<guide>, where <guide> is the guide's name in small letters with hyphens (welcome.guide.giving-feedback).",
  },
];

/**
 * The environment a program is started with in demo mode. Its browser engine is told to draw all text with plain grey
 * smoothing, never the coloured kind: the coloured kind can switch on or off for a label next to a control drawn in its
 * own layer, depending on timing, which made two takes differ (2026-11-15). Grey smoothing also suits video better, as
 * coloured fringes do not survive compression. The engine's own default options are kept, since this setting replaces
 * them.
 *
 * Studio's own window starts with the very same settings (BROWSER_SETTINGS in src-tauri/src/main.rs), so the two can share
 * one browser data folder: the engine refuses to share a folder between two sets of settings. Measured on 2026-11-15:
 * with the shared folder, six takes in a row gave the same pictures; with a folder of the practice program's own (and
 * with software drawing) the rounded corners of some controls came out one to three levels of brightness apart from run
 * to run.
 */
export const TAKE_BROWSER_SETTINGS = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-lcd-text";

export function demoEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: TAKE_BROWSER_SETTINGS };
}

export function findProgram(id: string): ProgramEntry {
  const p = PROGRAMS.find((x) => x.id === id);
  if (!p) {
    throw new Error(`Studio does not know how to start "${id}" in demo mode yet. Known programs: ${PROGRAMS.map((x) => x.id).join(", ")}. See docs/demo-hook.md for adding one.`);
  }
  return p;
}
