// The programs Studio knows how to start in demo mode. Each entry says how to launch it with the demo flag and how to
// find its window. A program joins this list once it includes the demo-mode hook (docs/demo-hook.md).

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export interface ProgramEntry {
  id: string;
  name: string;
  /** The program and its arguments, given the hook's address and token and the display to use. */
  launch(root: string, endpoint: string, token: string, monitor: number): { exe: string; args: string[] };
  /** Part of the program window's title, or its program file's name, to find the window to record. */
  windowTitle: string;
}

export const PROGRAMS: ProgramEntry[] = [
  {
    id: "practice-planner",
    name: "Practice Planner",
    launch(root, endpoint, token, monitor) {
      const exe = resolve(root, "src-tauri/target/release/openstage-studio.exe");
      if (!existsSync(exe)) throw new Error(`OpenStage Studio is not built yet (${exe}). Run "Build Studio.bat" first.`);
      return { exe, args: ["--sample-program", "--demo-hook", endpoint, "--demo-token", token, "--monitor", String(monitor)] };
    },
    windowTitle: "Practice Planner (OpenStage Studio sample program)",
  },
  {
    id: "openstage-author",
    name: "OpenStage Author",
    launch(root, endpoint, token, monitor) {
      // Author's editor, built from its own repository beside this one, or wherever OPENSTAGE_AUTHOR_EXE says.
      const exe = process.env.OPENSTAGE_AUTHOR_EXE ?? resolve(root, "../openstage-author/editor/src-tauri/target/release/openstage-editor.exe");
      if (!existsSync(exe)) throw new Error(`OpenStage Author's editor was not found (${exe}). Build it in its own folder, or set OPENSTAGE_AUTHOR_EXE to where it is.`);
      // A clean folder for the demo courses of this take, always at the same place, so two takes look the same.
      const workspace = resolve(root, "work/demo-workspace/openstage-author");
      rmSync(workspace, { recursive: true, force: true });
      mkdirSync(workspace, { recursive: true });
      return { exe, args: ["--demo-hook", endpoint, "--demo-token", token, "--demo-workspace", workspace, "--monitor", String(monitor)] };
    },
    windowTitle: "openstage-editor",
  },
];

export function findProgram(id: string): ProgramEntry {
  const p = PROGRAMS.find((x) => x.id === id);
  if (!p) {
    throw new Error(`Studio does not know how to start "${id}" in demo mode yet. Known programs: ${PROGRAMS.map((x) => x.id).join(", ")}. See docs/demo-hook.md for adding one.`);
  }
  return p;
}
