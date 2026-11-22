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
    ],
    // PrismQDA names its controls from its own code in demo mode (app/ui/src/demonames.ts on its studio-demo-hook branch), so most of
    // them appear only once their page or window is open. Run the course's tools/controls.ts to see the names on screen.
    appearing: [
      { pattern: "**", about: "a control on a page or in a window that opens later: by its element id (pane-sources, the Documents pane) or, for an item of a list or tree, the id of the part it is in, item and its key (codebook-tree.item.12), or by its place: the id of the part it is in, its group, its kind and its number there" },
    ],
    notes: "In demo mode no Windows box ever opens: a box for choosing a file answers at once with the next file of the workspace's Files folder for that kind (Files/documents, Files/image, Files/media, Files/reference, Files/web, Files/email; a folder there is offered as several files at once), a folder to import is the next of Files/folder, a project is saved in the workspace's Projects, and a file in its Exports. Open project opens the demo project opened last. Check for updates acts as if the offline lock were on, and the program never hands itself to a PrismQDA the person has open. The coder is the invented Riley. The clock stands still in demo mode (18 March 2026, 14:30 UTC).",
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
