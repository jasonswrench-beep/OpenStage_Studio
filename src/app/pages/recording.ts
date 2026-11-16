// From a recording: a recording made by an OpenStage recorder (a `.capture` folder, the shared capture format) becomes a
// draft script that Studio performs again in the real program, so the video is repeatable and can be made again after a
// new version. Studio checks every step in the program first (nothing is recorded) and lists what a person should look
// at; the person reads the script and makes the narration better before making the video.

import type { Page } from "../context.ts";
import { button, el, heading, resultLine, selectField, textField } from "../ui.ts";
import { act, chooseFolder, fileName } from "./common.ts";

interface Imported {
  file: string;
  notesFile: string;
  resolved: boolean;
  steps: number;
  take: number;
  program: string;
  notes: string[];
  problems: string[];
}

export const recording: Page = {
  id: "recording",
  name: "From a recording",
  async show(host, ctx) {
    const s = await ctx.status();
    const result = resultLine();
    const after = el("div");
    let project = "";
    const chosen = el("p", { id: "recording-line" }, "No recording chosen yet.");
    const take = textField("Take (its number; empty for the last finished take with clicks)", { hint: "A recording can hold several takes." });
    const demos = s.programs.flatMap((p) => p.demos.map((d) => ({ value: d, text: `${d} (${p.name})` })));
    const demo = selectField("The demo project the video starts in", [{ value: "", text: "The program's first demo project" }, ...demos]);
    const title = textField("Title (empty for the recording's own)", { wide: true });
    const goal = textField("Goal: what the viewer can do after watching (one line)", { wide: true });

    const make = button("Make a draft script", async () => {
      if (!project) return result.set("Choose a recording first.", "bad");
      after.replaceChildren();
      const r = await act<Imported>(result, "Making a script from the recording", "import-recording", {
        project, take: take.input.value.trim(), demo: demo.select.value, title: title.input.value, goal: goal.input.value,
      });
      if (!r) return;
      result.set(`${r.resolved ? "Made" : "Made, with a step to fix,"} ${fileName(r.file)}: ${r.steps} steps from take ${r.take}, in ${r.program}.${r.resolved ? " Every control was found in the program." : ""}`, r.resolved && !r.problems.length ? "good" : "bad");
      const next = button("Make a video of it", () => ctx.go("make", { script: r.file }));
      after.append(
        el("h3", {}, "What to look at before making the video"),
        el("ul", { className: "problems" }, ...[...r.notes, ...r.problems].map((n) => el("li", {}, n))),
        el("p", { className: "muted" }, `The script is ${r.file}, and these notes are in ${r.notesFile}. Open the script in a text editor to make the narration better.`),
        el("div", { className: "actions" }, next),
      );
      next.focus();
    });

    host.append(
      heading("From a recording"),
      el("p", {}, "A recording made with an OpenStage recorder, with its interaction log turned on, can become a tutorial script. Studio turns each click and what was typed into a step, then performs the steps in the program to find each control (on the take screen; nothing is recorded). The video is then made from the script, so it is the same every time and can be made again after a new version of the program."),
      el("p", { className: "muted" }, "The recording itself is not changed. Window titles are not copied into the script. Only programs Studio can perform are supported."),
      el("div", { className: "actions" }, button("Choose a recording…", async () => {
        const f = await chooseFolder("Choose a recording (a folder whose name ends in .capture)");
        if (f) {
          project = f;
          chosen.textContent = `Recording: ${fileName(f)}`;
        }
      }, { quiet: true })),
      chosen, take.wrap, demo.wrap, title.wrap, goal.wrap,
      el("div", { className: "actions" }, make),
      result.el, after,
    );
  },
};
