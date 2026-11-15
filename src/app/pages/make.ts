// Make a video: choose a script (from the work folder, or any file), see what the format check says about it, and make
// the video on the take screen. When it is made, its review is one button away.

import { readTextFile } from "@tauri-apps/plugin-fs";
import { describeAction } from "../../captions/captions.ts";
import { describeProblems, validateScript } from "../../script/validate.ts";
import type { Page } from "../context.ts";
import { button, choiceGroup, el, heading, resultLine } from "../ui.ts";
import { act, chooseFile, fileName } from "./common.ts";

/** What the format check says about a script, as a list a person can read. */
async function checkScript(path: string): Promise<{ ok: boolean; summary: string; lines: string[]; steps: string[] }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readTextFile(path));
  } catch (e) {
    return { ok: false, summary: `${fileName(path)} could not be read as a script: ${e instanceof Error ? e.message : String(e)}`, lines: [], steps: [] };
  }
  const v = validateScript(parsed);
  const summary = v.ok
    ? `${fileName(path)} passes the format check${v.warnings.length ? `, with ${v.warnings.length} warning${v.warnings.length === 1 ? "" : "s"}` : ""}. The scan for blocked names runs when the video is made.`
    : `${fileName(path)} does not pass the format check: ${v.errors.length} error${v.errors.length === 1 ? "" : "s"}. It cannot be made into a video until they are fixed.`;
  const steps = v.script ? v.script.steps.map((s) => `${describeAction(s)}${s.silent ? " (silent)" : `: "${s.narration}"`}`) : [];
  return { ok: v.ok, summary, lines: describeProblems(v), steps };
}

export const make: Page = {
  id: "make",
  name: "Make a video",
  async show(host, ctx) {
    const [s, lib] = await Promise.all([ctx.status(), ctx.library()]);
    const asked = (ctx.arg as { script?: string } | undefined)?.script;
    const options = lib.scripts.map((x) => ({ value: x.file, text: x.title, hint: `(${x.steps} steps, ${fileName(x.file)}${x.series ? ", from a manual" : ""})` }));
    if (asked && !options.some((o) => o.value === asked)) options.unshift({ value: asked, text: fileName(asked), hint: "(chosen)" });
    const chosen = asked ?? options[0]?.value;
    const group = choiceGroup("Script", options, chosen);
    const checkOut = el("div", { className: "check", "aria-live": "polite" });
    const result = resultLine();
    const after = el("div", { className: "actions" });

    const showCheck = async () => {
      const path = group.value();
      checkOut.replaceChildren();
      if (!path) return;
      const c = await checkScript(path);
      checkOut.append(el("p", {}, c.summary));
      if (c.lines.length) checkOut.append(el("ul", { className: "problems" }, ...c.lines.map((l) => el("li", {}, l))));
      if (c.steps.length) checkOut.append(el("details", {}, el("summary", {}, `Its ${c.steps.length} steps`), el("ol", { className: "steps" }, ...c.steps.map((l) => el("li", {}, l)))));
    };
    group.inputs.forEach((i) => i.addEventListener("change", () => void showCheck()));

    const other = button("Choose another script file…", async () => {
      const p = await chooseFile("Choose a tutorial script", "Tutorial script", ["json"]);
      if (p) ctx.go("make", { script: p });
    }, { quiet: true });

    const note = el("p", { id: "take-note", className: "muted" },
      `The program is opened full screen on display ${s.monitor}${s.monitor === 1 ? ", the main one" : ""}, and worked by Studio, not by your mouse or keyboard. Leave that display alone until the video is made. ${s.voice.ready ? "" : "The voice is not downloaded yet: download it on the Home page first."}`);
    const go = button("Make the video", async () => {
      const path = group.value();
      if (!path) return result.set("Choose a script first.", "bad");
      after.replaceChildren();
      const made = await act<{ folder: string; video: string; seconds: number; flags: number }>(result, `Making the video of ${fileName(path)}`, "make-video", { script: path });
      if (!made) return;
      result.set(`Made ${fileName(made.video)}: ${made.seconds} seconds. ${made.flags ? `The scans raised ${made.flags} flag${made.flags === 1 ? "" : "s"} to look at.` : "The scans raised no flags."} Review it before it is exported.`, "good");
      const review = button("Review it", () => ctx.go("review", { folder: made.folder }));
      after.append(review);
      review.focus();
    }, { describedBy: "take-note" });

    host.append(
      heading("Make a video"),
      options.length ? group.wrap : el("p", {}, "There are no scripts in your work folder yet. Choose a script file, or write some from a manual."),
      el("div", { className: "actions" }, other),
      el("h3", {}, "Format check"), checkOut,
      el("h3", {}, "Make it"), note, el("div", { className: "actions" }, go), result.el, after,
    );
    await showCheck();
  },
};
