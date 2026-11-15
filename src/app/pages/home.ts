// Home: where a person's work is, what is ready, and the first three things to do.

import type { Page } from "../context.ts";
import { button, el, heading, resultLine } from "../ui.ts";
import { act } from "./common.ts";

export const home: Page = {
  id: "home",
  name: "Home",
  async show(host, ctx) {
    const s = await ctx.status();
    const result = resultLine();
    const state = (ready: boolean, yes: string, no: string) => el("strong", {}, ready ? `✓ ${yes}` : `✗ ${no}`);

    const voiceNote = el("p", { id: "voice-note", className: "muted" },
      `Studio narrates with ${s.voice.name}, a speech model that runs on this computer. It downloads ${s.voice.left} from ${s.voice.source} (licence: ${s.voice.licence}), once, into ${s.voice.folder}. Nothing from your projects is sent.`);
    const getVoice = button(`Download the voice (${s.voice.left})`, async () => {
      if (await act(result, "Downloading the voice", "get-voice")) {
        result.set("The voice is ready.", "good");
        ctx.go("home");
      }
    }, { describedBy: "voice-note" });

    const steps = el("ol", { className: "start" },
      el("li", {}, s.voice.ready ? "The voice is downloaded. " : "Download the voice (below). ", el("span", { className: "muted" }, "Videos are narrated with it.")),
      el("li", {}, "Make the example video: ", button("Make the example video", () => ctx.go("make", { script: `${s.examples}\\plan-a-lesson.json` }), { quiet: true })),
      el("li", {}, "Watch and approve it: ", button("Review the videos", () => ctx.go("review"), { quiet: true })));

    host.append(
      heading("Home"),
      el("p", {}, "OpenStage Studio turns a tutorial script into a narrated, captioned video of a program, made on this computer. A person reviews and approves each video before it is exported."),
      el("h3", {}, "Getting started"), steps,
      el("h3", {}, "What is ready"),
      el("dl", { className: "facts" },
        el("dt", {}, "Your work"), el("dd", {}, s.workspace, " ", button("Change the work folder", () => ctx.go("settings"), { quiet: true })),
        el("dt", {}, "The voice"), el("dd", {}, state(s.voice.ready, "Downloaded", "Not downloaded yet")),
        el("dt", {}, "AI"), el("dd", {}, `Studio uses ${s.ai.says}. `, button("Change the AI", () => ctx.go("ai"), { quiet: true })),
        el("dt", {}, "Connector for an assistant"), el("dd", {}, s.connector.on ? `On, for ${s.connector.folder}` : "Off", " ", button("Change the connector", () => ctx.go("connector"), { quiet: true })),
        el("dt", {}, "Take screen"), el("dd", {}, `Display ${s.monitor}${s.monitor === 1 ? " (the main one)" : ""}. Videos are recorded there, full screen.`)),
      s.voice.ready ? el("p", {}) : el("div", { className: "panel" }, voiceNote, getVoice),
      result.el,
    );
  },
};
