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

/** Prism Transcribe's window with the demo hook: where PRISM_TRANSCRIBE_EXE says, else a build of Transcribe's branch
 * `studio-demo-hook` beside this repository (its own checkout, Prism_Transcription-demo). The installed Transcribe has no hook, so it is
 * never used. Null if none is there. */
export function transcribeExe(root: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const places = [env.PRISM_TRANSCRIBE_EXE, resolve(root, "../Prism_Transcription-demo/target/release/prism-transcribe.exe")];
  return places.find((p): p is string => !!p && existsSync(p)) ?? null;
}

/** The names of one recording's controls in Prism Transcribe, by the slug of its label (INT-01 is int-01). */
function transcribeFile(slug: string, label: string): { pattern: string; about: string }[] {
  return [
    { pattern: `file.${slug}`, about: `the card of the recording ${label} in Recordings; a click chooses it and shows its transcript` },
    { pattern: `file.${slug}.card`, about: `the whole card of ${label}, with its buttons and words (for callouts)` },
    { pattern: `file.${slug}.edit`, about: `Edit on ${label}'s card, shown once it is transcribed` },
    { pattern: `file.${slug}.transcribe`, about: `Transcribe (or Transcribe again, Add to the queue) on ${label}'s card` },
    { pattern: `file.${slug}.export`, about: `Export... on ${label}'s card` },
    { pattern: `file.${slug}.details`, about: `Details... on ${label}'s card` },
    { pattern: `file.${slug}.cancel`, about: `Cancel on ${label}'s card while it is being transcribed` },
  ];
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
      { pattern: "dialog.field.text", about: "the box The lines of the Paste text window (File > Paste text); each line is typed with a new line (\\n in the script's JSON) between them" },
      { pattern: "guide.para.*", about: "the row of the guide's paragraph number * on the page, counting from 0 at the guide's title; a click puts the cursor there. page.guide is the page that scrolls" },
      { pattern: "page.sp-list", about: "the list of styles in the Styles window (Format > Styles); typing a style's name, such as OSG Lesson, chooses it. The window's Close is dialog.ok" },
      { pattern: "dialog.field.template", about: "What kind of form, in the New form window (Insert > Form or the Forms tool's New form); typing a template's first words, such as Action plan, chooses it" },
      { pattern: "dialog.field.title", about: "Title of the form, in the New form window" },
      { pattern: "dialog.field.kind", about: "Called a, in the New form window: Handout, Worksheet, Checklist, Form, Template or Cards" },
      { pattern: "dialog.field.facilitator", about: "For the facilitator only, the tick box of the New form window" },
      { pattern: "page.cs-input", about: "the box of Search for a command, once it is open (bar.search or Ctrl+K)" },
      { pattern: "page.cs-opt-*", about: "the command numbered * in the list Search for a command shows, counting from 0 at the top" },
    ],
    notes: "The welcome page shows first. A menu's commands show only after its name is clicked (menu.file, menu.edit and the rest); a command is menu.<menu>.<command>, such as menu.file.newGuide or menu.help.about. The buttons on the navy bar while a guide is open are bar.reviewGuide, bar.updateGuide and bar.participantWorkbook; bar.search opens the command search. bar.name and bar.saved are the guide's name and the saved word on the navy bar: words to point a callout at, not to click. A callout on the navy bar needs a light color, such as #FFD23F, to be seen. A dialog's buttons are dialog.ok (its main button, whatever its words), dialog.cancel and dialog.close. Opening a demo guide shows the guide on the left and the tools pane on the right. In demo mode the tools pane's controls are pane.<id> and other page controls page.<id>; a dialog's boxes are dialog.name and dialog.field.<field>, its choices dialog.guide.<guide> and dialog.choice.<choice>, and a guide on the welcome page welcome.guide.<guide>, where <guide> is the guide's name in small letters with hyphens (welcome.guide.giving-feedback).",
  },
  {
    id: "prism-transcribe",
    name: "Prism Transcribe",
    launch(root, endpoint, token, monitor) {
      const exe = transcribeExe(root);
      if (!exe) throw new Error("Prism Transcribe with the demo hook was not found. Build the window of Transcribe's branch studio-demo-hook (in its app folder: node ui\\node_modules\\@tauri-apps\\cli\\tauri.js build --no-bundle), or set PRISM_TRANSCRIBE_EXE.");
      // A clean workspace for this take, always at the same place, so two takes look the same and the folders on screen never name the
      // person. Transcribe keeps its settings, the demo projects and every file it saves there in demo mode.
      const workspace = resolve(studioWorkspace(), "work", "demo-workspace", "prism-transcribe");
      rmSync(workspace, { recursive: true, force: true });
      mkdirSync(workspace, { recursive: true });
      return { exe, args: ["--demo-hook", endpoint, "--demo-token", token, "--demo-workspace", workspace, "--monitor", String(monitor)] };
    },
    windowTitle: "Prism Transcribe (demo mode)",
    demos: [
      { name: "none", about: "No project open: the page Start with a project, with New project and Open project. The two recordings INT-01 (two-speaker.wav) and FG-01 (four-speaker.wav) wait in the workspace, so Import... offers both." },
      { name: "imported", about: "The project Spring Teacher Interviews with the two recordings imported (copied into the project) and not transcribed: INT-01, an interview (58 seconds, 2 speakers, English), and FG-01, a focus group (58 seconds, 4 speakers, English). Computer voices, every name invented." },
      { name: "transcribed", about: "The project Spring Teacher Interviews with INT-01 and FG-01 transcribed by the light pack and not edited: speakers are Speaker 1 and so on, review status Not started." },
    ],
    appearing: [
      { pattern: "dialog.ok", about: "the main button of the dialog that is open (Create, Import, Save)" },
      { pattern: "dialog.cancel", about: "the Cancel button of the dialog that is open" },
      { pattern: "dialog.name", about: "Name in the New project dialog" },
      { pattern: "dialog.folder", about: "the words saying which folder the New project dialog will use (for callouts)" },
      { pattern: "dialog.chooseFolder", about: "Choose folder... in the New project dialog; in demo mode it answers at once with an empty folder in the workspace, with no Windows box" },
      { pattern: "dialog.field.label", about: "Label in the Import or Details dialog of a recording" },
      { pattern: "dialog.field.date", about: "Date recorded in the Import or Details dialog" },
      { pattern: "dialog.field.interviewer", about: "Interviewer in the Import or Details dialog" },
      { pattern: "dialog.field.speakers", about: "Expected number of speakers in the Import or Details dialog (a number box)" },
      { pattern: "dialog.field.language", about: "Language in the Import or Details dialog (a two-letter code such as en)" },
      { pattern: "dialog.field.note", about: "Note in the Import or Details dialog" },
      { pattern: "dialog.copy", about: "the tick box Copy the recording into the project folder, in the Import dialog" },
      { pattern: "dialog.advanced", about: "Advanced settings... (then Hide the advanced settings) in the Import or Details dialog" },
      { pattern: "dialog.pack.auto", about: "Automatic, under Speech model pack in Advanced settings" },
      { pattern: "dialog.pack.light", about: "Light pack, under Speech model pack in Advanced settings" },
      { pattern: "dialog.pack.heavy", about: "Heavy pack, under Speech model pack in Advanced settings (not installed: never choose it in a take)" },
      { pattern: "dialog.tracks.mixed", about: "Everyone in one mix, under Who is on which microphone in Advanced settings" },
      { pattern: "dialog.tracks.tracks", about: "One audio track per person, under Who is on which microphone" },
      { pattern: "dialog.tracks.channels", about: "One channel per person, under Who is on which microphone" },
      { pattern: "settings.offline", about: "the switch Offline: make no network calls at all, in Settings" },
      { pattern: "settings.threads.auto", about: "Automatic (up to 8), under Processor threads in Settings" },
      { pattern: "start.newProject", about: "New project on the page Start with a project" },
      { pattern: "start.openProject", about: "Open project on the page Start with a project; in demo mode it opens the demo project opened last, with no Windows box" },
      { pattern: "files.import", about: "Import... above Recordings; in demo mode it offers the workspace's two recordings at once, with no Windows box" },
      { pattern: "files.queueAll", about: "Queue all n untranscribed above Recordings, shown when two or more recordings wait" },
      { pattern: "files.exportAll", about: "Export all... above Recordings, shown when two or more recordings are transcribed" },
      { pattern: "transcript.summary", about: "the line under the transcript's heading: turns, speakers, and words the recognizer was unsure of" },
      { pattern: "transcript.turn.*", about: "turn number * of the transcript shown on the right, counting from 0; page.transcript is the pane" },
      { pattern: "notice.text", about: "the words of the message line under the bar (for callouts)" },
      { pattern: "notice.dismiss", about: "Dismiss on the message line" },
      { pattern: "handoff.text", about: "the words of the PrismQDA message after a PrismQDA or REFI-QDA export" },
      { pattern: "handoff.dismiss", about: "Dismiss on the PrismQDA message" },
      { pattern: "status.offline", about: "the Offline word in the status bar, shown when Offline is on" },
      { pattern: "status.protection", about: "the status bar's words about password protection, shown when it is on" },
      { pattern: "models.download", about: "Download the speech models, on the Speech models panel shown only when the light pack is missing (in demo mode it never downloads)" },
      { pattern: "page.help", about: "the Help window (bar.help or F1), which scrolls" },
      { pattern: "help.start", about: "Getting started in the Help window" },
      { pattern: "help.keys", about: "Keys in the editor in the Help window" },
      { pattern: "help.privacy", about: "Privacy in brief in the Help window" },
      { pattern: "help.about", about: "About in the Help window, with the version" },
      { pattern: "dialog.close", about: "Close in the Help window" },
      { pattern: "dialog.print", about: "Print in the Help window (never press it in a take: Windows' print box opens)" },
      ...transcribeFile("int-01", "INT-01"),
      ...transcribeFile("fg-01", "FG-01"),
    ],
    notes: "Prism Transcribe has no menus: the bar along the top holds bar.deidentify and bar.privacy (with a project open), bar.newProject, bar.openProject, bar.settings and bar.help (F1 also opens Help). With a project open, Recordings is on the left, one card per recording (file.int-01, file.fg-01 and their buttons), and the transcript of the chosen recording on the right. The status bar names are status.models, status.ffmpeg and status.cleanUp. In demo mode no Windows box ever opens: a box for choosing a file or folder answers at once with a place in the workspace, a file is saved in the workspace's Exports, nothing is downloaded, no Windows notification is shown, Check for updates acts as if Offline were on, and PrismQDA is never started. The Windows account name the program shows (in the de-identification log) is the invented researcher.",
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
