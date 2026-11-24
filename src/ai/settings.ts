// Which AI Studio uses, if any. AI is optional: with no AI, every stage has a file a person writes by hand.
//
// The choice is kept on this computer only, in Studio's settings folder (%APPDATA%\org.openstage.studio\ai.json), never
// in a project or the repository. A key typed in for a hosted service is kept there, encrypted by Windows for this person
// (src/ai/key-guard.ts), and sent only to that service.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { windowsKeyGuard, type KeyGuard } from "./key-guard.ts";

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
  /** The person's key. Only in memory: in the file it is `keyProtected`. */
  key?: string;
  /** For "custom": whether it can be shown pictures. */
  pictures?: boolean;
}

export function settingsFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.APPDATA ?? env.HOME ?? ".", "org.openstage.studio", "ai.json");
}

/** The choice. A key kept in clear by an earlier version is protected, and the file written again, the first time it is read. */
export function readAiSettings(file = settingsFile(), guard: KeyGuard = windowsKeyGuard): AiSettings {
  if (!existsSync(file)) return { choice: "none" };
  let kept: AiSettings & { keyProtected?: string };
  try {
    kept = JSON.parse(readFileSync(file, "utf8")) as typeof kept;
  } catch {
    return { choice: "none" };
  }
  const { keyProtected, ...s } = kept;
  if (s.choice !== "builtin" && s.choice !== "hosted") return { choice: "none" };
  if (s.key) {
    try {
      writeAiSettings(s, file, guard);
    } catch {
      // It could not be protected now (the helper is not built): it works as before, and is protected another time.
    }
    return s;
  }
  if (!keyProtected) return s;
  try {
    return { ...s, key: guard.unprotect(keyProtected) };
  } catch {
    // Protected for another person or computer: the key is asked for again.
    return s;
  }
}

/** Keep the choice, with the key protected. Throws, in words, rather than keep a key in clear. */
export function writeAiSettings(s: AiSettings, file = settingsFile(), guard: KeyGuard = windowsKeyGuard): void {
  const { key, ...rest } = s;
  let keyProtected: string | undefined;
  if (key) {
    try {
      keyProtected = guard.protect(key);
    } catch (e) {
      throw new Error(`The key was not saved, because it could not be protected: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  mkdirSync(dirname(file), { recursive: true });
  // Written whole beside the file, then put in its place, so a stop half way never loses the settings.
  writeFileSync(`${file}.new`, JSON.stringify({ ...rest, ...(keyProtected ? { keyProtected } : {}) }, null, 2) + "\n");
  renameSync(`${file}.new`, file);
}

/** Whether a service's address keeps what is sent to it private: https, or http to this computer only. */
export function safeAddress(address: string | undefined): boolean {
  try {
    const u = new URL(address ?? "");
    return u.protocol === "https:" || (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname));
  } catch {
    return false;
  }
}

export function presetOf(s: AiSettings): Preset | undefined {
  return PRESETS.find((p) => p.id === s.preset);
}

/** What a hosted choice still needs before it can be used, in words, or null if nothing. */
export function missing(s: AiSettings): string | null {
  if (s.choice !== "hosted") return null;
  const p = presetOf(s);
  if (!p) return "Choose a service.";
  if (p.id === "custom" && !safeAddress(s.address)) return "Give the service's address (starting with https://, or http:// for a service on this computer).";
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
