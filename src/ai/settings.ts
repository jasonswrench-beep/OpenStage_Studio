// Which AI Studio uses, if any. AI is optional: with no AI, every stage has a file a person writes by hand.
//
// The choice is kept on this computer only, in Studio's settings folder (%APPDATA%\org.openstage.studio\ai.json), never
// in a project or the repository. A key typed in for a hosted service is kept there and sent only to that service.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Protocol = "anthropic" | "chat-completions";

/** A hosted AI service a person can choose. Named, because a person needs the name to set Studio up. */
export interface Preset {
  id: string;
  name: string;
  protocol: Protocol;
  /** The service's address for chat-completions services. */
  address?: string;
  /** A model to start with, where one can be suggested safely; otherwise the person types the model's name. */
  defaultModel?: string;
  /** Whether the service can be shown pictures (rehearsal repair sends a picture of the demo workspace when it can). */
  pictures: boolean;
}

export const PRESETS: Preset[] = [
  { id: "claude", name: "Claude (Anthropic)", protocol: "anthropic", defaultModel: "claude-opus-5-5", pictures: true },
  { id: "chatgpt", name: "ChatGPT (OpenAI)", protocol: "chat-completions", address: "https://api.openai.com/v1", pictures: true },
  { id: "gemini", name: "Gemini (Google)", protocol: "chat-completions", address: "https://generativelanguage.googleapis.com/v1beta/openai", pictures: true },
  { id: "custom", name: "Another service (its chat-completions address)", protocol: "chat-completions", pictures: false },
];

export interface AiSettings {
  /** No AI, the built-in model on this computer, or a hosted service with the person's own key. */
  choice: "none" | "builtin" | "hosted";
  preset?: string;
  model?: string;
  /** For "custom": the service's chat-completions address. */
  address?: string;
  key?: string;
  /** For "custom": whether it can be shown pictures. */
  pictures?: boolean;
}

export function settingsFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.APPDATA ?? env.HOME ?? ".", "org.openstage.studio", "ai.json");
}

export function readAiSettings(file = settingsFile()): AiSettings {
  if (!existsSync(file)) return { choice: "none" };
  try {
    const s = JSON.parse(readFileSync(file, "utf8")) as AiSettings;
    return s.choice === "builtin" || s.choice === "hosted" ? s : { choice: "none" };
  } catch {
    return { choice: "none" };
  }
}

export function writeAiSettings(s: AiSettings, file = settingsFile()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
}

export function presetOf(s: AiSettings): Preset | undefined {
  return PRESETS.find((p) => p.id === s.preset);
}

/** What a hosted choice still needs before it can be used, in words, or null if nothing. */
export function missing(s: AiSettings): string | null {
  if (s.choice !== "hosted") return null;
  const p = presetOf(s);
  if (!p) return "Choose a service.";
  if (p.id === "custom" && !/^https?:\/\//.test(s.address ?? "")) return "Give the service's address (starting with https://).";
  if (!(s.model ?? p.defaultModel)) return "Give the name of the model to use.";
  if (!s.key?.trim() && p.id !== "custom") return "Give your key for the service.";
  return null;
}

/** The choice in words, for logs and the guard report. Never shows the key. */
export function describeChoice(s: AiSettings): string {
  if (s.choice === "builtin") return "the built-in model on this computer";
  if (s.choice === "hosted") {
    const p = presetOf(s);
    return `${p?.name ?? "a hosted service"}, model ${s.model ?? p?.defaultModel ?? "(not set)"}`;
  }
  return "no AI";
}

/** The plain warning a person sees before choosing a hosted service. */
export const HOSTED_NOTE = "With a hosted service, the manual's text, the scripts and pictures of the demo workspace are sent to that service. Studio never sends pictures from outside the demo workspace, and never sends your key anywhere else.";
