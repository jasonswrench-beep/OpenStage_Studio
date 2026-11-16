// What every page is given: a way to go to another page, the window's status line, and Studio's state (from the engine's
// status job, asked again whenever a page needs it fresh).

import { ask } from "./engine.ts";

export interface Status {
  installed: boolean;
  workspace: string;
  examples: string;
  monitor: number;
  voice: { name: string; ready: boolean; folder: string; left: string; licence: string; source: string };
  builtinAi: { name: string; ready: boolean; folder: string; left: string; licence: string };
  ai: { choice: "none" | "builtin" | "hosted"; preset: string | null; model: string | null; address: string | null; pictures: boolean | null; hasKey: boolean; says: string; file: string };
  presets: { id: string; name: string; defaultModel: string | null; custom: boolean }[];
  hostedNote: string;
  programs: { id: string; name: string; demos: string[] }[];
  connector: { on: boolean; folder?: string };
  authorExe: string | null;
}

export interface Library {
  workspace: string;
  scripts: { file: string; title: string; steps: number; series: string | null; renderName: string }[];
  videos: { folder: string; name: string; reviewed: boolean; says: string; open: boolean }[];
  series: string[];
  lectures: { file: string; title: string; slides: number }[];
}

export interface Ctx {
  /** Go to a page, with something for it (a script to select, a video to open). */
  go(page: string, arg?: unknown): void;
  /** Put a short message in the window's status line. */
  say(text: string): void;
  /** What the page was opened with, if anything. */
  arg?: unknown;
  status(): Promise<Status>;
  library(): Promise<Library>;
}

export interface Page {
  id: string;
  name: string;
  show(host: HTMLElement, ctx: Ctx): Promise<void> | void;
}

export const fetchStatus = () => ask<Status>("status");
export const fetchLibrary = () => ask<Library>("library");
