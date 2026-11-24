// One way for every AI role to ask a question, whichever AI is chosen: the built-in model on this computer, a hosted service
// through its own library, or a hosted service that speaks the common chat-completions request.

import Anthropic from "@anthropic-ai/sdk";
import { readLocalManifest, startLocalAi, type LocalServer } from "./local.ts";
import { describeChoice, missing, presetOf, readAiSettings, type AiSettings } from "./settings.ts";

export interface Question {
  /** What the role is and the rules it works to. */
  system: string;
  /** The material and the request. */
  user: string;
  /** Pictures of the demo workspace (PNG), only ever sent when the service can see pictures. */
  pictures?: Buffer[];
  /** Ask for JSON only. */
  json?: boolean;
  maxTokens?: number;
}

export interface Answerer {
  /** Who answers, in words, for the scripts' writtenBy and the reports. */
  name: string;
  /** Whether it can be shown pictures. */
  pictures: boolean;
  ask(q: Question): Promise<string>;
  close(): Promise<void>;
}

/** The models that accept the server-side fallback on a refusal. */
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

function claude(key: string, model: string): Answerer {
  const client = new Anthropic({ apiKey: key, timeout: 10 * 60 * 1000 });
  return {
    name: `Claude (${model})`,
    pictures: true,
    async ask(q) {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [
        ...(q.pictures ?? []).map((png) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: png.toString("base64") } })),
        { type: "text" as const, text: q.user },
      ];
      const fallback = FALLBACK_MODELS.has(model);
      const stream = client.beta.messages.stream({
        model,
        max_tokens: q.maxTokens ?? 32000,
        system: q.system,
        messages: [{ role: "user", content }],
        output_config: { effort: "medium" },
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      } as Anthropic.Beta.MessageCreateParamsStreaming);
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") throw new Error("The service declined to answer this request.");
      if (message.stop_reason === "max_tokens") throw new Error("The answer was cut off because it was too long.");
      return message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    },
    close: async () => undefined,
  };
}

interface ChatOptions {
  /** Extra fields for the request, such as the built-in model's settings. */
  extra?: Record<string, unknown>;
  /** Whether the service can be asked for JSON only (the built-in model can). */
  jsonMode?: boolean;
}

function chatCompletions(name: string, address: string, model: string, key: string | undefined, pictures: boolean, o: ChatOptions = {}): Answerer {
  return {
    name,
    pictures,
    async ask(q) {
      const parts: unknown[] = [{ type: "text", text: q.user }];
      if (pictures) for (const png of q.pictures ?? []) parts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } });
      const res = await fetch(`${address.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: q.system }, { role: "user", content: parts.length === 1 ? q.user : parts }],
          max_tokens: q.maxTokens ?? 8000,
          ...o.extra,
          ...(q.json && o.jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        if (res.status === 401 || res.status === 403) throw new Error(`The service refused the key (${res.status}). Check it in Set Up AI.bat.`);
        throw new Error(`The service answered with an error (${res.status}): ${body}`);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
      const choice = data.choices?.[0];
      if (choice?.finish_reason === "length") throw new Error("The answer was cut off because it was too long.");
      return choice?.message?.content ?? "";
    },
    close: async () => undefined,
  };
}

/** The answerer for the chosen AI. Throws, in words, if there is none or it is not set up. */
export async function openAnswerer(settings: AiSettings = readAiSettings(), log: (s: string) => void = () => undefined): Promise<Answerer> {
  if (settings.choice === "none") throw new Error("No AI is chosen. Run \"Set Up AI.bat\" to choose one, or write the scripts by hand.");
  if (settings.choice === "builtin") {
    const server: LocalServer = await startLocalAi(readLocalManifest(), { log });
    const a = chatCompletions(server.model, server.address, "local", server.key, false, { extra: { temperature: 0.2, chat_template_kwargs: { enable_thinking: false } }, jsonMode: true });
    return { ...a, close: () => server.stop() };
  }
  const gap = missing(settings);
  if (gap) throw new Error(`The AI is not set up yet: ${gap} Run "Set Up AI.bat".`);
  const p = presetOf(settings)!;
  const model = settings.model ?? p.defaultModel!;
  log(`Using ${describeChoice(settings)}.`);
  if (p.protocol === "anthropic") return claude(settings.key!, model);
  return chatCompletions(`${p.name.split(" (")[0]} (${model})`, p.id === "custom" ? settings.address! : p.address!, model, settings.key, p.id === "custom" ? !!settings.pictures : p.pictures);
}

/** The first JSON object or list in an answer, ignoring any words or code fences around it. */
export function jsonIn(answer: string): unknown {
  const text = answer.replace(/```(?:json)?/gi, "");
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error("The answer had no JSON in it.");
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("The answer's JSON was not finished.");
}
