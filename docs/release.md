# The installer and the installed app

First built on 2026-11-15. Before this, Studio ran only from the repository, through the double-click files.

## What the installer is

One setup file, `OpenStage-Studio-<release>-Setup.exe`, that installs Studio for the person who runs it, with no
administrator rights, into `%LOCALAPPDATA%\OpenStage Studio`, with a Start menu entry and an entry in Add or Remove
Programs. `<setup> /S` does the same without asking anything. The first release is `0.1.0-alpha.1` (`RELEASE` in
`tools/build-installer.mjs`; the version in `tauri.conf.json`, `package.json` and the `Cargo.toml` files stays the plain
`0.1.0` until a new version).

Installed, the window does everything the double-click files do: make a video, review it, plan and write scripts from a
manual, the queue, the release check, AI and connector setup, and settings. Each job is run by the **engine**: Studio's own
code (`src/engine/main.ts`, the same code the double-click files run) bundled into one file and run by a copy of Node.js
carried in the installer, so nothing else is needed on the computer.

What is inside the installer, by its place in the install folder:

| Place | What |
|---|---|
| `openstage-studio.exe` | The window (and the practice program, started with `--sample-program`) |
| `studio-helper.exe` | The helper: window capture, narration, frame drawing, MP4, accessibility driver |
| `engine\engine.mjs`, `engine\pdf.worker.mjs` | The engine, and PDF.js's worker file, which it loads by name |
| `node\node.exe`, `node\LICENSE.txt` | Node.js v24.22.3, pinned in `tools/node-runtime.json` |
| `tools\kokoro-model.json`, `tools\local-ai.json` | The download lists for the voice and the built-in model |
| `examples\` | The example scripts, the practice manual and the guard examples |
| `LICENSE.txt`, `NOTICE.txt`, `third-party\` | The licences |

Not inside: the voice (340 MB) and the built-in AI model (2.8 GB). Each downloads only when a person asks, on the Home and
AI pages, and is checked file by file.

## Where things go once installed

- **A person's work** (videos, series, packages, their blocklist): `Documents\OpenStage Studio`, or another folder chosen
  on the Settings page. The examples are copied into its `Examples` folder the first time.
- **Settings for this computer** (the work folder, the take screen, where OpenStage Author is, the AI choice and key, the
  connector): `%APPDATA%\org.openstage.studio\` (`studio.json`, `ai.json`, `connector.json`).
- **Downloads**: `%LOCALAPPDATA%\org.openstage.studio\voices` and `...\ai`. Before 2026-11-15 they were in
  `%LOCALAPPDATA%\OpenStage Studio`, which is now the install folder; anything still there is moved across the first time
  it is needed (`src/paths.ts`), so nothing is downloaded again and uninstalling cannot take the downloads with it.

Uninstalling removes only the files the installer put in the install folder. The interactive uninstaller also offers
"Delete app data", off unless ticked: it removes Studio's settings (the AI choice and key included) and the downloads
(`%APPDATA%\org.openstage.studio` and `%LOCALAPPDATA%\org.openstage.studio`), never the work folder.

Run from the repository, nothing changes: the work folder is the repository, the take screen is in `local-settings.json`,
and the double-click files work as before. `src/paths.ts` is the one place that decides.

## Making and trying an installer

Double-click, in this order:

1. **`Build Installer.bat`** runs `tools/build-installer.mjs` without signing. It fetches the pinned Node.js the first time
   (36 MB, checked by its SHA-256), bundles the engine, builds the helper, the app and the per-user installer, and checks
   them: every file Studio needs is in the setup, no file in it names this computer's user folder, and the web view's setup
   is carried inside (nothing is downloaded while installing). It writes
   `src-tauri\target\release-files\OpenStage-Studio-<release>-Setup.exe` and its SHA-256. The first build also needs the
   internet for Tauri's installer tool.
2. **`Check Engine.bat`** (optional, before installing): runs the bundled engine from a folder laid out like the install
   folder, with empty settings, and makes the example video through it; the frames must be the very ones the repository
   makes.
3. **`Test Installed App.bat`** installs the setup silently, then works the installed window only through Windows'
   accessibility interface, as a screen reader does: every page opens by its name and every control on it has a name; it
   sets the take screen on the Settings page, makes the example video from the window and opens its review. Then it
   uninstalls Studio and checks that the work folder and the downloads are still there. If Studio was installed before the
   test, it is updated and left installed.

A bare `cargo build --release` in `src-tauri` is not a release program: it loads its pages from the development server.
Use `Build Studio.bat` (or `npx tauri build --no-bundle`).

## Signing and publishing

A release is signed on the publisher's computer and published only with the owner's yes: `docs/code-signing.md`.

## What was found while building it

- **The practice program needs its own browser-engine data folder.** Takes run the practice program's browser engine with
  grey text smoothing (`src/pipeline/programs.ts`), and the engine refuses to share a data folder between two sets of
  settings, so a take started from Studio's window (which runs with the ordinary settings) got a blank program and timed
  out. It now keeps its data in `%LOCALAPPDATA%\org.openstage.studio\practice-program`.
- **With that fresh data folder, one take in five differed from the others**, by one level of brightness on the rounded
  corners of two controls (48 pixels). The browser engine starts drawing in software and moves to the graphics card once
  that is ready, and the two smooth curved edges a little differently, so the moment of the move (timing) decided which
  pictures had which corners; the old shared folder had happened to make the move at the same step every time. Programs in
  demo mode now draw in software only (`--disable-gpu`, `src/pipeline/programs.ts`). The example's frame fingerprint is
  now a76c2a692e538f8d.
- **Every module thought it was the program being run** once bundled into one file, since they all share that file's
  address. `src/util/is-main.ts` decides; the bundle marks itself, and only the engine's own command line starts.
- **Installed, the engine first did nothing at all.** The shell handed Node.js the engine's path in Windows' long-path form
  (`\\?\C:\...`), which did not match the engine's own address, so it did not know it was the program being run. The shell
  now passes plain paths, and `isMain` compares paths without that prefix and in one letter case. The bundled-engine check
  had not caught it, because it starts the engine with plain paths; only the installed test did.
- **The silent uninstaller hands itself to a temporary copy and returns at once**, and from an AI assistant's packaged
  session that copy did nothing. The installed test runs it in place (`uninstall.exe /S _?=<install folder>`), which waits
  until it is done and leaves only itself, then removes it. Uninstalling from Add or Remove Programs is not affected.
- **Documents can be somewhere else.** On Jason's computer it is in OneDrive (`OneDrive\Documents`); the window asks
  Windows for the Documents folder, so the work folder follows it.

## What was tried on the installed app (2026-11-15)

`Test Installed App.bat` on the unsigned setup: it installed silently; all 12 files Studio needs were in the install
folder; every page opened by its name and every control on every page had a name, through Windows' accessibility
interface; the take screen was set to display 2 on the Settings page; the example video was made from the installed window
on display 2 and its review opened with its Approve button; the examples were in the work folder; after uninstalling, the
work folder and the downloads were still there.

## Not tried yet

- The interactive installer wizard (only the silent install), a clean computer, or a second Windows account.
- A real screen reader on the new pages (the accessibility test checks names and that every page opens by its name, not
  how it sounds).
- A signed build (it waits for the owner's computer and signing account).
- Windows on ARM.
