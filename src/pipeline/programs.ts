// The programs Studio knows how to start in demo mode. Each entry says how to launch it with the demo flag and how to
// find its window. A program joins this list once it includes the demo-mode hook (docs/demo-hook.md).

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readStudioSettings, studioExe, workspace as studioWorkspace } from "../paths.ts";

/** OpenStage Author's program: where OPENSTAGE_AUTHOR_EXE or Studio's Settings say, else a build of Author's branch
 * `studio-demo-hook` beside this repository (its own checkout, openstage-author-demo, or Author's main checkout), else its usual
 * per-user install. Null if none is there. */
export function authorExe(root: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const local = env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const places = [
    env.OPENSTAGE_AUTHOR_EXE,
    readStudioSettings().authorExe,
    resolve(root, "../openstage-author-demo/editor/src-tauri/target/release/openstage-editor.exe"),
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

/** PrismQDA's window with the demo hook: where PRISMQDA_EXE says, else a build of PrismQDA's branch `studio-demo-hook` beside this
 * repository (its own checkout, prismqda-demo). The installed PrismQDA has no hook, so it is never used. Null if none is there. */
export function prismqdaExe(root: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const places = [env.PRISMQDA_EXE, resolve(root, "../prismqda-demo/app/src-tauri/target/release/prismqda-app.exe")];
  return places.find((p): p is string => !!p && existsSync(p)) ?? null;
}

/** OpenStage Assess's window with the demo hook: where OPENSTAGE_ASSESS_EXE says, else a build of OpenAssess's branch `studio-demo-hook`
 * beside this repository (its own checkout, openassess-demo). The installed OpenAssess has no hook, so it is never used. Null if none
 * is there. */
export function assessExe(root: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const places = [env.OPENSTAGE_ASSESS_EXE, resolve(root, "../openassess-demo/packages/app/shell/src-tauri/target/release/openassess-shell.exe")];
  return places.find((p): p is string => !!p && existsSync(p)) ?? null;
}

/** OpenStage Capture's window with the demo hook (the program is OpenExplainer; OpenStage Capture is its suite name): where
 * OPENSTAGE_CAPTURE_EXE says, else a build of OpenExplainer's branch `studio-demo-hook` beside this repository (its own checkout,
 * OpenExplainer-demo). The installed OpenExplainer has no hook, so it is never used. Null if none is there. */
export function captureExe(root: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const places = [env.OPENSTAGE_CAPTURE_EXE, resolve(root, "../OpenExplainer-demo/src-tauri/target/release/openexplainer.exe")];
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
  /** How a take films the program: its own window (the default), or the whole display it is on ("screen"), for a program that hides
   * its window or shows windows of its own beside it during a step (OpenStage Capture hides itself while it captures another
   * program). Such a program fills that display, so a place on its page is the same place in the picture. A script step in another
   * program's window (`window`) needs "screen". */
  film?: "window" | "screen";
  /** Other programs a take or a rehearsal opens first, on the take display, and closes afterward: the made-up programs a tutorial
   * works in beside the program itself (OpenStage Capture's Tea Timer). Each is waited for by part of its window's title. */
  companions?(root: string, monitor: number): { name: string; exe: string; args: string[]; windowTitle: string }[];
}

/** Tea Timer, the made-up program OpenStage Capture's course captures (a small program of the course's own): where OPENSTAGE_TEA_TIMER_EXE
 * says, else its build in the course folder beside this repository. Null if none is there. */
export function teaTimerExe(root: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const places = [env.OPENSTAGE_TEA_TIMER_EXE, resolve(root, "../Training Videos/OpenStage Capture/tea-timer/bin/Release/net10.0-windows/TeaTimer.exe")];
  return places.find((p): p is string => !!p && existsSync(p)) ?? null;
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
    demos: [
      { name: "minimal", about: "What Is Organizational Communication?, the smallest example: a Welcome slide (heading, body, a Continue button, an accent bar) and a Knowledge check slide." },
      { name: "lesson-parts", about: "Giving feedback: the parts, a short lesson made from the ready-made lesson slides." },
      { name: "giving-feedback", about: "Giving Feedback, the Author video course's demo course: six slides in three sections (Welcome, Objectives, What feedback is, The three-part model, a Knowledge check, a Summary)." },
      { name: "interactions", about: "Interactions demo, one slide for each of the sixteen interactions." },
      { name: "labeled-graphic", about: "Labeled graphic, a picture with numbered markers." },
      { name: "question-types", about: "Question types, one slide for each kind of question." },
      { name: "question-bank", about: "Question bank and timer example, a bank that draws questions, and a countdown timer." },
      { name: "sliders", about: "Sliders and dials, inputs that save a number." },
      { name: "looks", about: "Looks, a step marked as done and a button that starts disabled." },
      { name: "timed-media", about: "Notes that follow a video, things that come and go with a clip." },
      { name: "quiz-board", about: "Quiz board: accessibility basics, the quiz board game." },
      { name: "prize-ladder", about: "Prize ladder: general knowledge, the prize ladder game." },
      { name: "escape-room", about: "Escape room: your first day, the escape room game." },
      { name: "order-challenge", about: "Order challenge: steps at work, the order challenge game." },
      { name: "branching", about: "Branching demo, a story that branches." },
      { name: "scenario", about: "A Missed Deadline, a branching scenario with a cast of three, a choice of character, two meters and an ending." },
      { name: "conversation", about: "A Word in the Hallway, a conversation between characters." },
      { name: "lms-test-lesson", about: "Choosing the Right Channel at Work, the full 24-slide lesson made for trying a course in a learning system." },
      { name: "broken", about: "Deliberately Broken Fixture, a course with problems on purpose, for the Problems list." },
    ],
    // Author names its controls from its own code in demo mode (editor/src/demonames.ts on its studio-demo-hook branch), so most of
    // them appear only once their panel or window is open. Run the course's tools/controls.ts to see the names on screen.
    appearing: [
      { pattern: "slides.item.*", about: "slide number * in the Slides list, counting from 1 at the top" },
      { pattern: "slides.section.*", about: "the heading of section number * in the Slides list" },
      { pattern: "objects.item.*", about: "object number * in the Objects list of the layer being edited, counting from 1 at the top" },
      { pattern: "props-tab.**", about: "a tab of the Properties panel: props-tab.content, props-tab.style, props-tab.behaviour" },
      { pattern: "props-sec.**", about: "the heading of a section of the Properties panel that opens and closes, by its tab and title, such as props-sec.style.Appearance" },
      { pattern: "prop.**", about: "a field of the Properties panel, by its key in the code, such as prop.name, prop.size, prop.font, prop.decorative" },
      { pattern: "**", about: "a control in a window or panel that opens later: by its element id (te-box, the Edit text window's text) or by its place, the id or heading of the part it is in, its group, its kind and its number there (tp.dialog-actions.button.1, the theme window's Apply theme)" },
    ],
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
      { name: "none", about: "No project open: the page Start with a project, with New project and Open project. The two recordings INT-01 (two-speaker.wav) and FG-01 (four-speaker.wav) wait in the workspace: each Import... offers one of them in turn, INT-01's first, so the import window shows one recording's fields." },
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
      { pattern: "files.import", about: "Import... above Recordings; in demo mode it offers one of the workspace's two recordings each time (two-speaker.wav first, then four-speaker.wav), with no Windows box" },
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
      // De-identify (bar.deidentify), the Privacy window (bar.privacy) and the Export window (a card's Export... or files.exportAll).
      ...[
        ["deid.page", "the De-identify page (for callouts)"], ["deid.back", "← Recordings on the De-identify page"],
        ["deid.key.status", "the line with the key file's place and how many names and changes it holds"],
        ["deid.key", "the key file part, shown until a key file is ready (for callouts)"],
        ["deid.key.choose", "Choose where to save the key file… (in demo mode it saves in the workspace's Key files at once)"],
        ["deid.key.open", "Open an existing key file…"],
        ["deid.tabs", "the row of steps (for callouts)"], ["deid.tab.names", "1. Names"], ["deid.tab.details", "2. Personal details"],
        ["deid.tab.possible", "3. Possible names"], ["deid.tab.final", "4. Final check"], ["deid.tab.log", "Log"],
        ["deid.names.table", "the table of names (for callouts)"],
        ["deid.name.*", "row number * of the names table, from 1 (for callouts)"],
        ["deid.name.*.real", "Real name in row *; leaving it (Tab) fills the other spellings and a replacement"],
        ["deid.name.*.variants", "Other spellings in row *, commas between"], ["deid.name.*.replacement", "Replaced with in row *"],
        ["deid.name.*.kind", "Kind in row *: Person, Place, Organisation or Other"], ["deid.name.*.remove", "Remove on row *"],
        ["deid.names.add", "Add a name"], ["deid.names.paste", "Paste a roster…"],
        ["deid.names.replace", "Replace names in all transcripts… (dimmed until the list has names)"],
        ["deid.roster.text", "the Names box of Paste a roster, one name a line"], ["deid.roster.add", "Add to the list"], ["deid.roster.cancel", "Cancel in Paste a roster"],
        ["deid.preview", "the Replace names window (for callouts)"], ["deid.preview.list", "its counts for each file (for callouts)"],
        ["deid.preview.ok", "Replace them"], ["deid.preview.cancel", "Cancel in the Replace names window"],
        ["deid.details.list", "the list of finds on Personal details (for callouts)"], ["deid.possible.list", "the list of possible names (for callouts)"],
        ["deid.final.list", "the files on Final check (for callouts)"],
        ["deid.details.lookAgain", "Look again on Personal details"], ["deid.details.count", "the words such as 2 to review"],
        ["deid.find.*", "find number * on Personal details, from 1 (for callouts)"], ["deid.find.*.replacement", "what find * is replaced with"],
        ["deid.find.*.accept", "Accept on find *"], ["deid.find.*.skip", "Skip on find *"],
        ["deid.possible.count", "the words such as 1 possible name"], ["deid.possible.*", "possible name number *, from 1 (for callouts)"],
        ["deid.possible.*.replacement", "what possible name * becomes"], ["deid.possible.*.kind", "its Kind"],
        ["deid.possible.*.accept", "Accept on possible name *"], ["deid.possible.*.notName", "Not a name on possible name *"],
        ["deid.wordList.text", "the project word list box"], ["deid.wordList.save", "Save the word list"],
        ["deid.final.checkAgain", "Check again on Final check"], ["deid.final.count", "the words such as 1 of 2 transcribed files pass"],
        ["deid.final.int-01", "INT-01 on Final check (for callouts)"], ["deid.final.int-01.result", "INT-01's result line"], ["deid.final.int-01.mark", "Mark as de-identified for INT-01"],
        ["deid.final.fg-01", "FG-01 on Final check (for callouts)"], ["deid.final.fg-01.result", "FG-01's result line"], ["deid.final.fg-01.mark", "Mark as de-identified for FG-01"],
        ["deid.log.table", "the Log table (for callouts)"], ["deid.log.*", "row * of the Log, newest first"],
        ["privacy.page", "the Privacy window (for callouts)"], ["privacy.protection.status", "the words saying whether protection is on"],
        ["privacy.password.new", "New password (at least 8 characters)"], ["privacy.password.again", "The same password again"],
        ["privacy.password.mismatch", "The two passwords are not the same."],
        ["privacy.password.understood", "the tick box I understand that if this password is lost…"],
        ["privacy.password.ok", "Protect the transcripts (or Change the password)"],
        ["privacy.lock", "Lock now"], ["privacy.changePassword", "Change the password…"], ["privacy.protectionOff", "Turn protection off"],
        ["privacy.statement", "the Data handling statement part (for callouts)"], ["privacy.statement.text", "the statement's text"],
        ["privacy.statement.docx", "Save as Word…"], ["privacy.statement.txt", "Save as text…"], ["privacy.done", "Done in the Privacy window"],
        ["privacy.unlock.password", "Password on the page of a locked project"], ["privacy.unlock.ok", "Unlock"], ["privacy.unlock.error", "That password is not right."],
        ["export.page", "the Export window (for callouts)"], ["export.format", "the Format choices (for callouts)"],
        ["export.format.docx", "Word (.docx)"], ["export.format.txt", "Plain text"], ["export.format.srt", "Captions, SubRip"], ["export.format.vtt", "Captions, WebVTT"],
        ["export.format.csv", "Table, CSV"], ["export.format.xlsx", "Table, Excel"], ["export.format.prismtx", "PrismQDA package"], ["export.format.qdpx", "REFI-QDA project"],
        ["export.timestamps", "the Timestamps choices, for Word and text (for callouts)"], ["export.text", "the Text choices, verbatim or clean (for callouts)"],
        ["export.timestamps.perTurn", "Timestamps: at the start of every turn"], ["export.timestamps.every", "Timestamps: every 30 seconds"], ["export.timestamps.none", "Timestamps: none"],
        ["export.text.verbatim", "Text: verbatim"], ["export.text.clean", "Text: clean"], ["export.lineNumbers", "Number the lines (Word)"],
        ["export.speakerNames", "Show who is speaking (captions)"], ["export.deidentified", "the tick box De-identified: check that no name from the list is in it"],
        ["export.noKey", "the words saying there is no key file yet"], ["export.notDeidentified", "the warning that a file is not marked de-identified"],
        ["export.leftovers", "the warning that names from the list are still there"], ["export.passes", "Passes the final check: no name from the list."],
        ["export.cancel", "Cancel in the Export window"], ["export.ok", "Choose where to save… (in demo mode it saves in the workspace's Exports at once)"],
      ].map(([pattern, about]) => ({ pattern, about })),
      // The queue panel, above Recordings once something is queued. A recording in it is queue.item.<slug>.
      { pattern: "queue.panel", about: "the Queue panel above Recordings (for callouts)" },
      { pattern: "queue.heading", about: "the Queue heading: not running, transcribing INT-01, or paused, and how many wait (for callouts)" },
      { pattern: "queue.run", about: "Run (Resume after Pause) in the Queue panel" },
      { pattern: "queue.pause", about: "Pause in the Queue panel, while it runs" },
      { pattern: "queue.cancelAll", about: "Cancel all in the Queue panel" },
      { pattern: "queue.clear", about: "Clear finished in the Queue panel" },
      { pattern: "queue.summary", about: "the summary shown when the queue has run to its end (for callouts)" },
      { pattern: "queue.dismiss", about: "Dismiss on the summary" },
      ...["int-01", "fg-01"].flatMap((slug) => [
        { pattern: `queue.item.${slug}`, about: `${slug.toUpperCase()} in the Queue panel (for callouts)` },
        { pattern: `queue.item.${slug}.state`, about: `the state of ${slug.toUpperCase()} in the queue: Waiting, Transcribing, Held, Done, Failed or Cancelled` },
        { pattern: `queue.item.${slug}.up`, about: `move ${slug.toUpperCase()} up one place (not on the first)` },
        { pattern: `queue.item.${slug}.down`, about: `move ${slug.toUpperCase()} down one place (not on the last)` },
        { pattern: `queue.item.${slug}.hold`, about: `Hold on ${slug.toUpperCase()}, while it waits or runs` },
        { pattern: `queue.item.${slug}.release`, about: `Release on ${slug.toUpperCase()}, while it is held` },
        { pattern: `queue.item.${slug}.remove`, about: `Remove ${slug.toUpperCase()} from the queue (the recording stays in the project)` },
      ]),
      // The editor, opened by Edit on a transcribed recording's card.
      { pattern: "editor.back", about: "← Recordings in the editor's bar: saves and goes back to the project" },
      { pattern: "editor.title", about: "the recording's label at the top of the editor (for callouts)" },
      { pattern: "editor.review", about: "the Review list in the editor's bar: Not started, First pass, Checked, De-identified, Final (typing a choice's words chooses it)" },
      { pattern: "editor.verbatim", about: "Verbatim in the editor's bar; pressed, it shows the clean view (read-only) and its words change to Clean view (read-only)" },
      { pattern: "editor.notation", about: "Notation in the editor's bar: the Insert notation list, for the place the cursor was" },
      { pattern: "editor.find", about: "Find in the editor's bar (Ctrl+F): the find and replace bar" },
      { pattern: "editor.speakers", about: "Speakers in the editor's bar (Ctrl+Shift+P): the Speakers panel" },
      { pattern: "editor.snapshots", about: "Snapshots in the editor's bar (Ctrl+Shift+S)" },
      { pattern: "editor.keys", about: "Keys in the editor's bar: the window that changes the editor's keys" },
      { pattern: "editor.saveState", about: "the words Unsaved changes or Saved and the time, in the editor's bar (for callouts)" },
      { pattern: "editor.save", about: "Save in the editor's bar (Ctrl+S), switched off until something changes" },
      { pattern: "editor.hint", about: "the line above the turns, which also says how far the transcript is checked (for callouts)" },
      { pattern: "editor.turns", about: "the list of turns on the left of the editor, which scrolls" },
      { pattern: "turn.*", about: "turn number * of the transcript in the editor, counting from 0, with its speaker and time (for callouts)" },
      { pattern: "turn.*.who", about: "the speaker list of turn number *; typing a speaker's name chooses it, and New speaker… makes one" },
      { pattern: "turn.*.text", about: "the words of turn number *, which are edited in place; click it with words to select those words (they play from there), then type to replace them, or press Backspace to remove them. Enter splits the turn at the selection's start; Alt+1 to Alt+9 give the turn, or the selected words, to speakers 1 to 9" },
      { pattern: "media.pane", about: "the recording pane on the right of the editor (for callouts)" },
      { pattern: "media.wave", about: "the waveform that follows the playhead, with the speakers' colours along its foot" },
      { pattern: "media.overview", about: "the overview of the whole recording under the waveform" },
      { pattern: "media.clock", about: "the playhead's time and the recording's length" },
      { pattern: "media.back", about: "back 2 seconds (F3)" },
      { pattern: "media.play", about: "Play, which becomes Pause (F4). In demo mode the playhead stands still while playing and nothing sounds: the word at the playhead is marked, and skips and clicks move it" },
      { pattern: "media.forward", about: "forward 2 seconds (F5)" },
      { pattern: "media.slower", about: "− beside Speed: 0.1 slower (F6)" },
      { pattern: "media.rate", about: "the Speed words, such as Speed 1.0× (for callouts)" },
      { pattern: "media.faster", about: "+ beside Speed: 0.1 faster (F7)" },
      { pattern: "media.boost", about: "the Volume boost list: Off, 1.5×, 2×, 3×, 4×" },
      { pattern: "find.bar", about: "the find and replace bar (for callouts)" },
      { pattern: "find.query", about: "Find, in the find and replace bar" },
      { pattern: "find.replace", about: "Replace with, in the find and replace bar" },
      { pattern: "find.wholeWord", about: "the tick box Whole word" },
      { pattern: "find.matchCase", about: "the tick box Match case" },
      { pattern: "find.scope.this", about: "This transcript, where Replace all replaces" },
      { pattern: "find.scope.project", about: "Whole project, where Replace all replaces (it saves first)" },
      { pattern: "find.count", about: "the words such as 1 of 3, or Not found (for callouts)" },
      { pattern: "find.previous", about: "Previous in the find bar" },
      { pattern: "find.next", about: "Next in the find bar" },
      { pattern: "find.replaceAll", about: "Replace all in the find bar" },
      { pattern: "find.close", about: "Close on the find bar" },
      { pattern: "page.notation", about: "the Insert notation window (for callouts)" },
      { pattern: "notation.item.*", about: "entry number * of the Insert notation list, counting from 1, such as [inaudible hh:mm:ss] or [crosstalk]; a click inserts it at the cursor" },
      { pattern: "notation.editList", about: "Edit this list… in the Insert notation window" },
      { pattern: "notation.cancel", about: "Cancel in the Insert notation window" },
      { pattern: "notation.text", about: "the box with one notation entry per line, after Edit this list…" },
      { pattern: "notation.back", about: "Back, after Edit this list…" },
      { pattern: "notation.saveList", about: "Save list, after Edit this list…" },
      { pattern: "page.snapshots", about: "the Snapshots window (for callouts)" },
      { pattern: "snapshots.list", about: "the list of snapshots in the Snapshots window (for callouts)" },
      { pattern: "snapshots.item.*", about: "snapshot number * in the Snapshots window, counting from 0 at Version 0 (for callouts)" },
      { pattern: "snapshots.item.*.restore", about: "Restore on snapshot number *" },
      { pattern: "snapshots.name", about: "Name for a new snapshot" },
      { pattern: "snapshots.save", about: "Save snapshot" },
      { pattern: "snapshots.close", about: "Close in the Snapshots window" },
      { pattern: "page.keys", about: "the Keys window (for callouts)" },
      { pattern: "keys.rewind", about: "Rewind on resume (seconds) in the Keys window" },
      { pattern: "keys.defaults", about: "Reset to defaults in the Keys window" },
      { pattern: "keys.cancel", about: "Cancel in the Keys window" },
      { pattern: "keys.save", about: "Save in the Keys window" },
      { pattern: "page.speakers", about: "the Speakers panel, which scrolls" },
      { pattern: "speaker.*", about: "the card of speaker number * in the Speakers panel, counting from 1 (for callouts)" },
      { pattern: "speaker.*.name", about: "Name shown in the transcript, on speaker number *'s card; the name is taken when the box is left (Tab)" },
      { pattern: "speaker.*.role", about: "the Role list on speaker number *'s card: Interviewer, Moderator, Participant, Other" },
      { pattern: "speaker.*.addAttribute", about: "Add an attribute on speaker number *'s card" },
      { pattern: "speaker.*.attr.*.name", about: "the name box of attribute number * (from 1) on a speaker's card, such as site or age band" },
      { pattern: "speaker.*.attr.*.value", about: "the value box of that attribute; it is kept when the box is left (Tab)" },
      { pattern: "speaker.*.mergeInto", about: "Merge into, the list of other speakers on speaker number *'s card" },
      { pattern: "speaker.*.merge", about: "Merge on speaker number *'s card, switched on once Merge into has a choice" },
      { pattern: "speaker.*.remove", about: "Remove this speaker, shown only on a speaker with no turns" },
      { pattern: "speakers.add", about: "Add a speaker in the Speakers panel" },
      { pattern: "speakers.expected", about: "Expected number of speakers, under Find the speakers again (a number box)" },
      { pattern: "speakers.findAgain", about: "Find speakers again (it takes some seconds)" },
      { pattern: "speakers.done", about: "Done, which closes the Speakers panel" },
    ],
    notes: "Prism Transcribe has no menus: the bar along the top holds bar.deidentify and bar.privacy (with a project open), bar.newProject, bar.openProject, bar.settings and bar.help (F1 also opens Help). With a project open, Recordings is on the left, one card per recording (file.int-01, file.fg-01 and their buttons), and the transcript of the chosen recording on the right. The status bar names are status.models, status.ffmpeg and status.cleanUp. In demo mode no Windows box ever opens: a box for choosing a file or folder answers at once with a place in the workspace, a file is saved in the workspace's Exports, nothing is downloaded, no Windows notification is shown, Check for updates acts as if Offline were on, and PrismQDA is never started. The Windows account name the program shows (in the de-identification log) is the invented researcher. The clock stands still in demo mode (Saved 10:30:00 AM, the same date everywhere). A recording being transcribed shows its progress line with the words Starting… until it is done, whatever the computer's speed: to show a transcription finishing, wait for the card's Edit button (a wait step with the target file.int-01.edit), which waits as long as the work takes and never shows the time in the video.",
  },
  {
    id: "prismqda",
    name: "PrismQDA",
    launch(root, endpoint, token, monitor) {
      const exe = prismqdaExe(root);
      if (!exe) throw new Error("PrismQDA with the demo hook was not found. Build the window of PrismQDA's branch studio-demo-hook (npm run build in app\\ui, then in app: node ui\\node_modules\\@tauri-apps\\cli\\tauri.js build --no-bundle), or set PRISMQDA_EXE.");
      // A clean workspace for this take, always at the same place, so two takes look the same and the folders on screen never name the
      // person. PrismQDA keeps its window's settings, the demo projects, the files its boxes offer and every file it saves there.
      const workspace = resolve(studioWorkspace(), "work", "demo-workspace", "prismqda");
      // The last start's project file can still be held for a moment while that program ends (it is stopped, not closed), so the
      // clearing tries again for a few seconds.
      rmSync(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      mkdirSync(workspace, { recursive: true });
      return { exe, args: ["--demo-hook", endpoint, "--demo-token", token, "--demo-workspace", workspace, "--monitor", String(monitor)] };
    },
    windowTitle: "PrismQDA (demo mode)",
    demos: [
      { name: "none", about: "No project open: the start page. The files of the invented Campus Commuting Study wait in the workspace's Files, for the boxes that choose files to offer." },
      { name: "empty", about: "The start page, with no project, export or class packet left in the workspace from an earlier step." },
      { name: "study-imported", about: "The Campus Commuting Study (Riverbend Community College) with all its material imported: the survey of 30 students as cases with their variables, six interviews (P19 with its recording), the parking and transit policy (PDF), field notes, the bike rack picture and the focus group recording; the interviews in cases P02 to P19. No codes yet." },
      { name: "study-coded", about: "The study as coded by Riley: 19 codes (Cost, Time and waiting, Safety, Wishes for change and their sub-codes, and others), 53 coded passages, an area of the bike rack picture, two stretches of the focus group, and two memos about the project. No themes, links or memos on passages yet." },
      { name: "study-merged", about: "The coded study with the second coder Jordan's work merged in (24 codings of the survey and four interviews), for measuring agreement and settling disagreements." },
      { name: "class-returned", about: "The coded study after a class exercise: three students' packets of the interviews of Maya Okafor and Priya Nair, coded and sent back, wait in the class folder beside the project (not yet brought in)." },
      // Bringing the material in, one kind at a time. Each of these stages says what Windows' file box answers in its takes (its
      // offers.json): the files its video chooses.
      { name: "study-new", about: "The Campus Commuting Study just made, from the reflexive thematic analysis template with its research question, and nothing in it yet. Choose files offers Tom Brandt's (Word) and Samira Haddad's (Markdown) interviews, then Priya Nair's field notes (text) and the parking policy (PDF)." },
      { name: "part2-transcripts", about: "The study with those four documents in Interviews and Documents. Choose files offers the interviews of Maya Okafor, Daniel Reyes and Priya Nair, as plain text transcripts." },
      { name: "part2-survey", about: "The study with the three transcripts too (Maya's in case P02). Choose files offers Survey answers (CSV, 30 rows)." },
      { name: "part2-folder", about: "The study with the survey answers too (30 cases with variables). Add Folder's Browse offers the folder Field notes (a folder for each campus, and a copy of Priya Nair's field notes); Choose files offers Priya's field notes again." },
      { name: "part2-pictures", about: "The study with the field notes too. Images offers the bike rack picture (PNG) and the photograph Bus stop in the rain (JPEG, with when, the camera and a place)." },
      { name: "part2-recordings", about: "The study with the two pictures too. Audio / Video offers Eli Washington's interview with its captions beside it, and the focus group recording, with none." },
      { name: "part2-more", about: "The study as coded by Riley (study-coded). Reference Library offers a library of four articles (RIS) and Prism Reference Manager's exchange file; Web / News a saved page about Route 52; Documents a PrismStatistics evaluation of the bus pass pilot, then Samira Haddad's interview checked against the recording (a newer version)." },
      // Reading and coding.
      { name: "part3-codebook", about: "The imported study with Riley's codebook (19 codes) made and only two passages of Priya Nair's interview coded (Weather, Health and being outside)." },
      { name: "part3-checking", about: "The study with the codebook and Riley's first pass over Maya Okafor's interview (9 codings), with two slips: the bus pass coded as Parking permit cost, and her embarrassment as Personal safety at night." },
      { name: "part3-units", about: "A second project, Commuting Survey Answers, made to code whole units: the survey answers and the transcripts of Maya Okafor and Daniel Reyes, with Riley's codebook and nothing coded." },
      // The codebook.
      { name: "part4-codebook", about: "The study as Riley has coded it (study-coded), with Maya Okafor's late bus marked as an example of Late or full bus. Import a codebook's Browse offers Transit access codebook.qdc, a colleague's codebook from another program." },
      { name: "part4-feelings", about: "The Part 4 codebook with How the trip feels and its codes The trip feels fine (Priya) and The trip is a struggle (Maya, Daniel), not yet in a group." },
      { name: "part4-tidy", about: "The Part 4 codebook with Late train (two codings: Samira Haddad, the survey) to merge, and Carpooling, never used, to retire." },
      // Themes.
      { name: "part7-themes", about: "The coded study with the manual's three themes: Money decides the mode (Cost, Parking), Waiting and not knowing (Time and waiting, Weather) and Feeling safe on the way (Safety)." },
      // Explore.
      { name: "part8-query", about: "The coded study with one saved query, Waiting on the North campus (Time and waiting in cases whose Campus is North), following the coding and not frozen." },
      // Data and statistics.
      { name: "part12-units", about: "Commuting Survey Answers, a project made to code whole units: 21 survey answers coded by Riley and by Jordan (merged in), who differ on four (agreement, disagreements and the final layer)." },
      { name: "part11-packet", about: "The coded study (study-coded) with a packet for a chatbot built and not answered yet (the survey answers; Weather, Road safety, Bike lockers and showers). Ctrl+V pastes the invented chatbot's reply." },
      { name: "part9-merge", about: "The coded study (study-coded); Merge from a file's Choose a file offers More facts.csv (a parking permit, dependants and distance for S01 to S30)." },
    ],
    // PrismQDA names its controls from its own code in demo mode (app/ui/src/demonames.ts on its studio-demo-hook branch), so most of
    // them appear only once their page or window is open. Run the course's tools/controls.ts to see the names on screen.
    appearing: [
      { pattern: "**", about: "a control on a page or in a window that opens later: by its element id (pane-sources, the Documents pane) or, for an item of a list or tree, the id of the part it is in, item and its key (codebook-tree.item.12), or by its place: the id of the part it is in, its group, its kind and its number there" },
    ],
    notes: "In demo mode no Windows box ever opens: a box for choosing a file answers at once with the next file of the workspace's Files folder for that kind (Files/documents, Files/image, Files/media, Files/reference, Files/web, Files/email; a folder there is offered as several files at once), a folder to import is the next of Files/folder, a project is saved in the workspace's Projects, and a file in its Exports. Open project opens the demo project opened last; the project to merge on the Team page is the next of Files/packets (Jordan's coded packet). Check for updates acts as if the offline lock were on, and the program never hands itself to a PrismQDA the person has open. The coder is the invented Riley. The clock stands still in demo mode (18 March 2026, 14:30 UTC).",
  },
  {
    id: "openstage-assess",
    name: "OpenStage Assess",
    launch(root, endpoint, token, monitor) {
      const exe = assessExe(root);
      if (!exe) throw new Error("OpenStage Assess with the demo hook was not found. Build the window of OpenAssess's branch studio-demo-hook (in packages\\app\\shell: npm run build:exe), or set OPENSTAGE_ASSESS_EXE.");
      // A clean workspace for this take, always at the same place, so two takes look the same and the folder the first screen names is
      // never the person's own. The app keeps its library there (a folder OpenAssess inside it), and a file it hands over in Downloads.
      const workspace = resolve(studioWorkspace(), "work", "demo-workspace", "openstage-assess");
      rmSync(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      mkdirSync(workspace, { recursive: true });
      return { exe, args: ["--demo-hook", endpoint, "--demo-token", token, "--demo-workspace", workspace, "--monitor", String(monitor)] };
    },
    windowTitle: "OpenStage Assess (demo mode)",
    demos: [
      { name: "empty", about: "No banks: the first screen with its four samples about the planets. No box for choosing files offers anything." },
      { name: "smoke", about: "No banks; Choose a file offers Planets test bank.docx (the app's own Word sample), for the hook's smoke test." },
      // The invented course Earth and Space Science 101 (Riverbend Community College, Professor Dana Whitfield), made by the OpenStage
      // Assess course's tools/demo-course/build.mjs. Each import stage has no banks and says what Choose a file offers, in turn.
      { name: "import-ch1", about: "No banks. Choose a file offers Chapter 1 test bank.docx (13 questions, all parsed), then Old midterm.doc, Lecture 1 slides.pptx and ~$apter 1 test bank.docx, each refused in words." },
      { name: "import-word", about: "No banks. Choose a file offers Chapter 2 quiz.docx (Word's own lists, a True / False heading, the quiz again after an Answer Key heading: 11 parsed), then Chapter 2 quiz (table).docx (a grid: 8 parsed)." },
      { name: "import-keys", about: "No banks. Choose a file offers Chapter 3 with an Answer line under each, then with an Answers list, then with the right answers in bold (12 parsed each; the bold one has the note that bold was taken as the key)." },
      { name: "import-objects", about: "No banks. Choose a file offers Chapter 4 test bank.docx: two pictures (one with no description, so its question needs review), an equation, a Greek letter from the Symbol font, a table of stars, hidden text and a text box, each named in the notes about the file." },
      { name: "import-table", about: "No banks. Choose a file offers Chapter 1 question table.xlsx, the blank table filled in (12 parsed)." },
      { name: "import-tables", about: "No banks. Choose a file offers Chapter 2 with details.xlsx (chapter, objective, Bloom level, difficulty and tags), Chapter 3 right answer first.xlsx (the answers mixed, and said), Chapter 4 numbered options.xlsx." },
      { name: "import-text", about: "No banks. Choose a file offers Chapter 3 quiz.txt, Chapter 3 quiz (Aiken).txt and Chapter 3 quiz.gift (its category kept as a tag)." },
      { name: "import-pdf", about: "No banks. Choose a file offers Chapter 4 test bank.pdf (12 questions, 2 to review for their pictures)." },
      { name: "import-lms", about: "No banks. Choose a file offers a colleague's bank Stars and planets as Moodle XML, QTI 1.2, QTI 2.1, QTI 3.0, Common Cartridge, Brightspace CSV and Blackboard, then Colleague's Moodle questions.xml, whose cloze question is kept as a failed essay." },
      { name: "import-repair", about: "No banks. Choose a file offers Chapter 1 test bank (needs repair).docx: 2 failed (no key; a key naming option E), 1 to review (two answers marked), 10 parsed, and 3 pieces of text no question used (the title, a heading, a note)." },
      { name: "course-bank", about: "The bank Earth and Space Science 101: 63 questions in four chapters with their details (chapter, section, objective, Bloom level, difficulty, tags), chapters 1 and 2 approved, 3 reviewed, 4 draft, two retired; one needs review (a picture with no description). It also holds last term's test ESS 101 Midterm, fall 2025, and that class's figures. Open a bank file offers From a colleague.openassess; Add a picture offers Plate boundaries.png." },
      { name: "course-folders", about: "The course bank with a folder for each chapter (Chapter 1 to Chapter 4), each chapter's questions filed in it." },
      { name: "course-test", about: "The course bank with the test ESS 101 Midterm, spring 2026: 24 questions, versions A and B, 2 short answers (2 points each, boxes on a second page) and an essay, 30 points, sheet code 776AF. Check my printing offers Blank sheet scan.png; Add scans offers Midterm scans 1.pdf then Midterm scans 2.pdf (32 sheets drawn and marked by the program, one page fed twice, a fall sheet's page at the end)." },
      { name: "course-scored", about: "As course-test, with the spring class's scores saved in Scores (32 complete sheets, every flag settled, the Milky Way question's second answer counted as right). Results from a learning system offers Chapter 3 quiz - Student Analysis.csv (Canvas, 36 attempts)." },
      { name: "course-history", about: "As course-scored, with the class figures of three classes kept in the bank: the fall midterm, the Canvas chapter 3 quiz and the spring midterm. Five questions are worth another look, and the eclipse question shows the earlier wording the fall class saw." },
      { name: "colleague-bank", about: "The course bank and the bank From a colleague, which opens with the note that formatting was taken out of one question." },
    ],
    // OpenStage Assess names its controls in demo mode (packages/app/ui/demo-names.js on its studio-demo-hook branch), most of them only
    // once their screen or dialog is drawn. Run the course's tools/controls.ts to see the names on screen.
    appearing: [
      { pattern: "dialog.ok", about: "the main button of the dialog that is open, whatever its words (Create, Save, Remove it)" },
      { pattern: "dialog.cancel", about: "the button of the open dialog that answers no (Cancel, Keep it)" },
      { pattern: "dialog.close", about: "the X in the corner of the open dialog" },
      { pattern: "dialog.action.*", about: "any other button of the open dialog, by its place counting from 1 at the left" },
      { pattern: "popup.*", about: "a command of a ... menu once it is open, by the same name as in the menu bar (popup.rename, popup.folders)" },
      { pattern: "page.*", about: "a control with a fixed id: page.import-file, page.ask-text (the box of a dialog that asks for a name), page.cs-input (Search for a command's box)" },
      { pattern: "**", about: "any other control, by its screen (home, import, bank, export, print, sheets, score, or dialog inside a dialog) and its accessible name in small letters with hyphens: home.choose-a-file, home.new-bank, home.try-it-a-word-test-bank, home.open-planets-quiz; a second with the same name gets .2" },
    ],
    notes: "The menus are menu.file, menu.bank, menu.question, menu.test and menu.help; a command shows only after its menu's name is clicked and is menu.<menu>.<command>: menu.file.newBank, menu.file.openBankFile, menu.file.importFile, menu.file.yourBanks, menu.file.showFolder, menu.bank.rename, menu.bank.folders, menu.bank.coverage, menu.bank.checkQuality, menu.bank.remove, menu.question.new-multipleChoice (and new-multipleResponse, new-trueFalse, new-fillInBlank, new-shortAnswer, new-matching, new-ordering, new-numeric, new-essay), menu.question.search, menu.question.clearFilters, menu.test.print, menu.test.sheets, menu.test.export, menu.help.search, menu.help.keys, menu.help.updates. The navy bar holds bar.search, and on a bank's screen bar.print, bar.sheets and bar.export, and bar.name, the bank's name (words for a callout, not a control). A callout on the navy bar needs a light color, such as #FFD23F. In demo mode no Windows box ever opens: a box for choosing files answers at once with the next file the stage offers for it (packages/app/demo on the branch), Save a copy saves into the workspace's Downloads with no dialog, Show in folder and Show this folder do nothing, and Check for updates is turned off. The first screen's line names the take's library folder inside Studio's workspace, which the project should blur.",
  },
  {
    id: "openstage-capture",
    name: "OpenStage Capture",
    launch(root, endpoint, token, monitor) {
      const exe = captureExe(root);
      if (!exe) throw new Error("OpenStage Capture with the demo hook was not found. Build OpenExplainer's branch studio-demo-hook (Build Demo.bat in C:\\Dev\\OpenExplainer-demo), or set OPENSTAGE_CAPTURE_EXE.");
      // A clean workspace for this take, always at the same place, so two takes look the same. The program keeps its settings, its
      // browser profile and every file it opens or saves there (Documents), never in the person's own folders.
      const workspace = resolve(studioWorkspace(), "work", "demo-workspace", "openstage-capture");
      rmSync(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      mkdirSync(workspace, { recursive: true });
      return { exe, args: ["--demo-hook", endpoint, "--demo-token", token, "--demo-workspace", workspace, "--monitor", String(monitor)] };
    },
    windowTitle: "OpenExplainer (demo mode)",
    // OpenStage Capture hides its window while it captures, and shows its own Cancel and Stop windows beside the program it captures,
    // so the take films the whole take display. In demo mode it fills that display and stays in front of Tea Timer.
    film: "screen",
    // Tea Timer is what the course captures. --backdrop puts a plain window behind it over the whole display, taskbar included, so
    // nothing else on the computer shows while OpenStage Capture is hidden; --still keeps its clock from counting, so takes repeat.
    companions(root, monitor) {
      const exe = teaTimerExe(root);
      if (!exe) throw new Error("Tea Timer was not found. Build it with Build Tea Timer.bat in the OpenStage Capture course folder, or set OPENSTAGE_TEA_TIMER_EXE.");
      return [{ name: "Tea Timer", exe, args: ["--screen", String(monitor), "--backdrop", "--still"], windowTitle: "Tea Timer" }];
    },
    // The invented book Brewing Good Tea about the made-up program Tea Timer (the program manual's own example), made by the OpenStage
    // Capture course's tools/demo-stages.ts into demo/stages on OpenExplainer's branch studio-demo-hook.
    demos: [
      { name: "empty", about: "The window as it opens: an empty project called Untitled project, not saved yet. No box for choosing files offers anything." },
      { name: "smoke", about: "The book Brewing Good Tea open and saved, for the hook's smoke test; Open project offers it again." },
      { name: "tea-book", about: "The book Brewing Good Tea about the made-up program Tea Timer, open and saved, with no pictures yet: Getting started (Choosing your tea, Starting a brew, Stopping early), Settings (Changing the settings, Choosing the bell) and When something goes wrong (The tea tastes bitter). Choosing your tea and Starting a brew are Drafted and have words; the variables PRODUCT, VERSION and COMPANY are Tea Timer, 2.0 and Tea Notes." },
      { name: "tea-finished", about: "The book Brewing Good Tea finished, open and saved: every topic written, mostly Reviewed; four pictures of Tea Timer (the window as it opens, Green tea chosen, brewing, and its Settings window) in Choosing your tea, Starting a brew and Changing the settings; a Caution and a Time saver box; and a short guide called Quick start with Starting a brew and Changing the settings." },
      { name: "tea-clicks", about: "The book Brewing Good Tea with its chapters and first words, open and saved, and three click pictures in 1.3 Stopping early, captured click by click in Tea Timer (Green tea, Start, Stop), each with a description and callout A round the click, and nothing yet on that topic's page. Write, Draft a procedure from the clicks, makes its steps." },
      { name: "tea-word", about: "An empty, untitled project, as the window opens, and a Word manual for Tea Timer (Tea Timer user manual.docx, the finished book exported as Word) that Import from Word brings in, with its headings, steps, boxes and pictures." },
      { name: "tea-import", about: "The book Brewing Good Tea as in tea-book, open and saved, and two pictures of Tea Timer as if from another screenshot tool (Tea Timer.png, the window as it opens, and Green tea chosen.png), which Import pictures brings in together." },
      { name: "tea-recording", about: "The book Brewing Good Tea as in tea-book, open and saved, and a real OpenStage Recorder recording (Recording 2026-11-26 2124.capture) of Tea Timer alone on its screen, made with mouse notes on: a click on Start, a click on Stop, and a third click on another screen. Import a recording brings it in." },
    ],
    // OpenStage Capture names its controls in demo mode (src/demo/names.ts on OpenExplainer's studio-demo-hook branch), most of them
    // only once their pane, menu or dialog is drawn.
    appearing: [
      { pattern: "menu.*.*", about: "a command of a menu under the navy bar once the menu is open, by its words without the dots: menu.file.new-project, menu.insert.capture, menu.help.keyboard-keys" },
      { pattern: "popup.*", about: "a command of an Add or ... menu of a pane once it is open, by its words: popup.add-chapter, popup.paragraph, popup.picture-view" },
      { pattern: "tree.*", about: "a chapter or topic in the list on the left, by its title: tree.getting-started, tree.starting-a-brew" },
      { pattern: "dialog.*", about: "a control of the open dialog, by its words: dialog.ok, dialog.cancel, dialog.close; a second with the same name gets .2" },
      { pattern: "**", about: "any other control, by its area (bar, tree, page, props, status) and its accessible name in small letters with hyphens" },
    ],
    notes: "The program's window says OpenExplainer; the course calls it OpenStage Capture. The menus are menu.file, menu.chapters, menu.insert, menu.write, menu.book, menu.view, menu.review, menu.tools and menu.help; a command shows only after its menu's name is clicked. The navy bar holds the project's name (bar.name, words for a callout), the search and the Save, Capture, Check and Export buttons; a callout on the navy bar needs a light color, such as #FFD23F. In demo mode no Windows box ever opens: a box for choosing files answers at once with the next file the stage offers for it, a file is saved into the take's Documents folder with no dialog, Check for updates asks nothing, and the Capture window lists only the made-up program Tea Timer's windows. Tea Timer is open behind the program from the start, on a plain background that fills the take display. While it captures, the program hides its own window and the take films the whole display, so the video shows Tea Timer, the Cancel window (top right, with Wait before capturing) and the Stop window of click by click. Steps in Tea Timer, the Stop window (\"OpenExplainer is capturing clicks\") or the Cancel window (\"OpenExplainer is capturing\") have window set to that title and name their control by fallback role and name: Tea Timer's buttons are Settings, Start, Stop and Reset, its list items Black tea, Green tea, Oolong, White tea and Herbal tea; its Settings window is \"Tea Timer Settings\". Its clock does not count down in a take.",
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
