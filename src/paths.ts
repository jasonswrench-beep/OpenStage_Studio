// Where things are. Studio's own files (the pinned download lists, the examples, the helper, Studio's program for the
// practice program) are in the app's folder; a person's work (videos, series, packages, their blocklist) is in the
// workspace; downloads (the voice and the AI model) are in Studio's data folder in local AppData.
//
// In the repository (development and the double-click files) the app's folder and the workspace are both the project
// folder, so everything stays where it always was. Installed, the window starts the engine with
// OPENSTAGE_STUDIO_RESOURCES (the install folder), OPENSTAGE_STUDIO_EXE (Studio's program) and OPENSTAGE_STUDIO_DOCUMENTS
// (the person's Documents folder) set, and the workspace is Documents\OpenStage Studio unless they chose another.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository's folder (meaningful only when running from the repository). */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const installed = (env: NodeJS.ProcessEnv = process.env): boolean => !!env.OPENSTAGE_STUDIO_RESOURCES;

/** Studio's own files: the install folder, or the repository. */
export function appRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENSTAGE_STUDIO_RESOURCES || REPO;
}

/** Settings for this computer, kept in %APPDATA%\org.openstage.studio\studio.json (installed Studio's take screen and workspace). */
export interface StudioSettings {
  workspace?: string;
  monitor?: number;
  /** Where OpenStage Author's program is, if not in its usual place. */
  authorExe?: string;
}

export function studioSettingsFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "org.openstage.studio", "studio.json");
}

export function readStudioSettings(file = studioSettingsFile()): StudioSettings {
  try {
    return JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as StudioSettings;
  } catch {
    return {};
  }
}

export function writeStudioSettings(s: StudioSettings, file = studioSettingsFile()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
}

/** The default workspace for an installed Studio: Documents\OpenStage Studio. */
export function defaultWorkspace(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.OPENSTAGE_STUDIO_DOCUMENTS || join(homedir(), "Documents"), "OpenStage Studio");
}

/** A person's work: the repository, or (installed) their chosen folder or Documents\OpenStage Studio. Made if missing. */
export function workspace(env: NodeJS.ProcessEnv = process.env): string {
  if (!installed(env)) return REPO;
  const w = readStudioSettings(studioSettingsFile(env)).workspace || defaultWorkspace(env);
  mkdirSync(w, { recursive: true });
  return w;
}

/** This computer's own settings: the take screen (and, installed, more). From local-settings.json in the repository, or
 * from studio.json installed. */
export function computerSettings(env: NodeJS.ProcessEnv = process.env): StudioSettings {
  if (installed(env)) return readStudioSettings(studioSettingsFile(env));
  try {
    return JSON.parse(readFileSync(join(REPO, "local-settings.json"), "utf8")) as StudioSettings;
  } catch {
    return {};
  }
}

/** The helper program: beside Studio when installed, or in its build folder in the repository. */
export function helperExe(env: NodeJS.ProcessEnv = process.env): string {
  const beside = join(appRoot(env), "studio-helper.exe");
  return installed(env) || existsSync(beside) ? beside : join(REPO, "studio-helper", "target", "release", "studio-helper.exe");
}

/** Studio's own program (which also opens the practice program). */
export function studioExe(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENSTAGE_STUDIO_EXE || join(REPO, "src-tauri", "target", "release", "openstage-studio.exe");
}

/** The examples: in the workspace's Examples folder when installed (copied there the first time), or the repository's. */
export function examplesDir(env: NodeJS.ProcessEnv = process.env): string {
  if (!installed(env)) return join(REPO, "examples");
  const dest = join(workspace(env), "Examples");
  const shipped = join(appRoot(env), "examples");
  if (!existsSync(dest) && existsSync(shipped)) cpSync(shipped, dest, { recursive: true });
  return dest;
}

/** Studio's data folder in local AppData, for the downloads. Before 2026-11-15 they were in %LOCALAPPDATA%\OpenStage Studio,
 * which is now where the per-user installer puts the program itself; anything still there is moved across (the same
 * drive, so at once) the first time it is asked for, so nothing is downloaded again and an uninstall cannot take it. */
export function downloadsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const local = env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const root = join(local, "org.openstage.studio");
  const old = join(local, "OpenStage Studio");
  for (const part of ["voices", "ai"]) {
    const from = join(old, part);
    const to = join(root, part);
    if (!existsSync(from)) continue;
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      if (existsSync(join(to, name))) continue;
      try {
        renameSync(join(from, name), join(to, name));
      } catch {
        // In use or on another drive: left where it is; the new place downloads its own copy if needed.
      }
    }
  }
  mkdirSync(root, { recursive: true });
  return root;
}
