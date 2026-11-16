// SPDX-License-Identifier: Apache-2.0
// The test of the INSTALLED app (Test Installed App.bat). It installs the setup that Build Installer.bat made, for this
// person only and without asking anything, then works the installed window only through Windows' accessibility interface
// (UI Automation, with Studio's own helper from the install folder), the way a screen reader does: every page is opened by
// its name, every control on it must have a name, the take screen is set on the Settings page, and the example video is
// made from the window and its review opened. Then it closes Studio, uninstalls it, and checks that the person's work and
// the downloads are still there. It imports nothing from the source: an installed app has none.
//
// node tools/release-smoke.mjs [<setup file>]
//
// If OpenStage Studio is already installed here, it is updated by the setup and left installed afterwards.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { NEEDED, RELEASE } from "./build-installer.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SETUP = resolve(process.argv[2] ?? join(ROOT, "src-tauri", "target", "release-files", `OpenStage-Studio-${RELEASE}-Setup.exe`));
const LOCAL = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
const INSTALL = join(LOCAL, "OpenStage Studio");
const EXE = join(INSTALL, "openstage-studio.exe");
/** Each page, by the name of its button in the page list, and a control the page shows once it has opened. */
const PAGES = {
  Home: "Make the example video",
  "Make a video": "Make the video",
  Review: "Open a video's folder…",
  "From a manual": "Choose a manual…",
  "From a recording": "Make a draft script",
  Lecture: "Write the lecture",
  Queue: "Run the queue",
  "Release check": "Run the release check",
  AI: "Save and try it",
  Connector: "Choose the folder…",
  Settings: "Save the settings",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
  return ok;
};

/** The take screen: this repository's local-settings.json says which display, or the second one. */
function takeScreen() {
  try {
    return JSON.parse(readFileSync(join(ROOT, "local-settings.json"), "utf8")).monitor ?? 2;
  } catch {
    return 2;
  }
}

/** Studio's helper, in its accessibility mode: one JSON command in, one JSON answer out. */
async function hands() {
  const h = spawn(join(INSTALL, "studio-helper.exe"), ["uia"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  const answers = [];
  createInterface({ input: h.stdout }).on("line", (l) => answers.push(JSON.parse(l)));
  const wait = async (n) => {
    for (let i = 0; i < 400 && answers.length <= n; i++) await sleep(50);
    if (answers.length <= n) throw new Error("The accessibility helper did not answer.");
    return answers[n];
  };
  await wait(0); // Its "ready".
  let next = 1;
  const ask = async (c) => {
    const n = next++;
    h.stdin.write(JSON.stringify(c) + "\n");
    const a = await wait(n);
    if (!a.ok) throw new Error(a.error ?? JSON.stringify(a));
    return a.result;
  };
  return {
    ask,
    controls: async () => (await ask({ cmd: "list" })).controls,
    press: (name, role = "button") => ask({ cmd: "do", key: { role, name }, action: "invoke" }),
    close: () => h.stdin.end(),
  };
}

/** Wait until a control with this name is in the window (or the time is up). */
async function waitFor(u, name, ms, every = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await u.controls()).some((c) => c.name === name)) return true;
    await sleep(every);
  }
  return false;
}

/** Whether any copy of Studio's program is still running. */
function running() {
  const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq openstage-studio.exe", "/NH"], { encoding: "utf8" });
  return /openstage-studio\.exe/i.test(r.stdout ?? "");
}

function documentsFolder() {
  // Windows' own answer for this person's Documents folder (it may be moved, or kept in a cloud folder).
  const r = spawnSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('MyDocuments')"], { encoding: "utf8" });
  return r.stdout.trim() || join(homedir(), "Documents");
}

async function main() {
  console.log(`Testing the installed OpenStage Studio ${RELEASE}.`);
  if (!existsSync(SETUP)) {
    console.log(`There is no setup at ${SETUP}. Run "Build Installer.bat" first.`);
    process.exit(2);
  }
  const wasInstalled = existsSync(EXE);
  const downloads = join(LOCAL, "org.openstage.studio", "voices");
  const hadDownloads = existsSync(downloads);
  spawnSync("taskkill", ["/F", "/IM", "openstage-studio.exe", "/T"], { stdio: "ignore" });

  console.log("1. Installing (for you only, no questions).");
  const installed = spawnSync(SETUP, ["/S"], { stdio: "ignore" });
  check(installed.status === 0 && existsSync(EXE), `the setup installed Studio into ${INSTALL}`);
  const missing = NEEDED.filter((p) => !existsSync(join(INSTALL, ...p.split("/"))));
  check(!missing.length, `every file Studio needs is in the install folder${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);

  console.log("2. The window, through the accessibility interface.");
  const app = spawn(EXE, ["--monitor", String(takeScreen())], { stdio: "ignore" });
  await sleep(6000);
  const u = await hands();
  try {
    await u.ask({ cmd: "attach", window: "OpenStage Studio" });
    for (const [page, shows] of Object.entries(PAGES)) {
      await u.press(page);
      check(await waitFor(u, shows, 30_000, 500), `the ${page} page opens by its name (it shows "${shows}")`);
      const controls = await u.controls();
      const unnamed = controls.filter((c) => !c.name?.trim() && c.role !== "list");
      check(!unnamed.length, `every control on ${page} has a name${unnamed.length ? ` (${unnamed.length} without: ${unnamed.map((c) => c.role).join(", ")})` : ""}`);
    }

    const screen = takeScreen();
    await u.press("Settings");
    await waitFor(u, PAGES.Settings, 30_000, 500);
    await u.ask({ cmd: "do", key: { role: "combobox", name: "The take screen: the display videos are recorded on" }, action: "choose", value: `Display ${screen}` });
    await u.press("Save the settings");
    await sleep(3000);
    let saved = null;
    try {
      saved = JSON.parse(readFileSync(join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "org.openstage.studio", "studio.json"), "utf8")).monitor;
    } catch {}
    check(saved === screen, `the take screen is set to display ${screen} on the Settings page`);
    await u.press("Home");
    await waitFor(u, PAGES.Home, 30_000, 500);

    const voice = existsSync(join(LOCAL, "org.openstage.studio", "voices")) || existsSync(join(LOCAL, "OpenStage Studio", "voices"));
    if (!voice) console.log("  (the voice is not downloaded on this computer, so no video can be made; the rest still runs)");
    else {
      console.log(`  making the example video from the window, on display ${screen} (about three minutes)...`);
      await u.press("Make the example video");
      await waitFor(u, "Make the video", 30_000, 500);
      await u.press("Make the video");
      if (check(await waitFor(u, "Review it", 8 * 60_000), "the example video was made from the window")) {
        await u.press("Review it");
        check(await waitFor(u, "Approve this video", 30_000), "its review opens, with the Approve button");
      }
    }
  } finally {
    u.close();
    app.kill();
    spawnSync("taskkill", ["/F", "/IM", "openstage-studio.exe", "/T"], { stdio: "ignore" });
  }

  const work = join(documentsFolder(), "OpenStage Studio");
  check(existsSync(join(work, "Examples", "plan-a-lesson.json")), `the examples are in your work folder (${work})`);

  if (wasInstalled) {
    console.log("3. Studio was installed before this test, so it is left installed (now updated).");
  } else {
    console.log("3. Uninstalling.");
    // Studio must have closed first, or its program file is still in use.
    for (let i = 0; i < 30 && running(); i++) await sleep(1000);
    // Run in place (_?=), so it finishes before going on; it then leaves only itself, which is removed here.
    spawnSync(join(INSTALL, "uninstall.exe"), ["/S", `_?=${INSTALL}`], { stdio: "ignore" });
    for (let i = 0; i < 30 && existsSync(EXE); i++) await sleep(1000);
    rmSync(join(INSTALL, "uninstall.exe"), { force: true });
    try {
      rmdirSync(INSTALL);
    } catch {
      // Not empty: something of the person's is still there (such as downloads from before 2026-11-15), so it stays.
    }
    check(!existsSync(EXE), "the program is gone after uninstalling");
    check(existsSync(join(work, "Examples")), "your work folder is still there");
    if (hadDownloads || existsSync(downloads)) check(existsSync(downloads) && statSync(downloads).isDirectory(), "the downloads are still there (Studio's data folder is not the install folder)");
  }

  console.log(failures ? `\nFAIL: ${failures} check(s) did not pass.` : "\nPASS: the installed app works, through its accessibility interface.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(`\nThe test could not finish: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
