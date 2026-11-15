// The queue (make many videos unattended) and the release check (after a new version of a program, find the steps it
// broke). Both are started by a person and say what they did in a report (docs/batch.md).

import type { Page } from "../context.ts";
import { button, checkbox, el, heading, reportBlock, resultLine } from "../ui.ts";
import { act, chooseFile, chooseFolder, fileName } from "./common.ts";

/** A list of manuals, series folders or scripts a person builds up; empty means the default. */
function pathList(what: string) {
  const items: string[] = [];
  const ul = el("ul", { className: "paths" });
  const empty = el("p", { className: "muted" }, `Nothing chosen: ${what}.`);
  const draw = () => {
    ul.replaceChildren(...items.map((p, i) => el("li", {}, p, " ", button(`Remove ${fileName(p)}`, () => {
      items.splice(i, 1);
      draw();
      (ul.querySelector("button") ?? add).focus();
    }, { quiet: true }))));
    empty.hidden = items.length > 0;
  };
  const add = button("Add a manual or script…", async () => {
    const p = await chooseFile("Choose a manual or a script", "Manual or script", ["openexplainer", "pdf", "json"]);
    if (p && !items.includes(p)) items.push(p);
    draw();
  }, { quiet: true });
  const addFolder = button("Add a folder…", async () => {
    const p = await chooseFolder("Choose a series folder or a folder of scripts");
    if (p && !items.includes(p)) items.push(p);
    draw();
  }, { quiet: true });
  return { wrap: el("div", {}, empty, ul, el("div", { className: "actions" }, add, addFolder)), items };
}

export const queue: Page = {
  id: "queue",
  name: "Queue",
  async show(host, ctx) {
    const s = await ctx.status();
    const paths = pathList("every series in your work folder");
    const result = resultLine();
    const out = el("div");
    host.append(
      heading("Queue"),
      el("p", {}, `The queue makes many videos without anyone watching: from manuals (planned, written and rehearsed with ${s.ai.says}), series folders or scripts. A script that exists is never changed; only scripts that pass rehearsal are recorded, and every video still waits for a person's review before export.`),
      el("p", { className: "muted" }, `It uses display ${s.monitor} for a long time and keeps the computer awake while it runs.`),
      el("h3", {}, "What to make"), paths.wrap,
      el("div", { className: "actions" }, button("Run the queue", async () => {
        out.replaceChildren();
        const r = await act<{ counts: Record<string, number>; report: string; text: string }>(result, "Running the queue", "queue", { paths: paths.items });
        if (!r) return;
        const said = Object.entries(r.counts).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing to do";
        result.set(`The queue finished: ${said}. The report is in ${r.report}.`, r.counts.broken || r.counts["not recorded"] ? "bad" : "good");
        out.append(reportBlock("Queue report", r.text));
      })),
      result.el, out,
    );
  },
};

export const release: Page = {
  id: "release",
  name: "Release check",
  async show(host, ctx) {
    const s = await ctx.status();
    const paths = pathList("every series in your work folder, and the examples");
    const useAi = checkbox("Propose a repair for each broken script, with the AI (written beside it, never recorded)", s.ai.choice !== "none");
    if (s.ai.choice === "none") useAi.input.disabled = true;
    const result = resultLine();
    const out = el("div");
    host.append(
      heading("Release check"),
      el("p", {}, "After a new version of a program, the release check rehearses every script in it and reports the steps the new version broke. Nothing is recorded, and no script is changed."),
      el("h3", {}, "What to check"), paths.wrap, useAi.wrap,
      el("div", { className: "actions" }, button("Run the release check", async () => {
        out.replaceChildren();
        const r = await act<{ checked: number; broken: number; report: string; text: string }>(result, "Running the release check", "release-check", { paths: paths.items, useAi: useAi.input.checked });
        if (!r) return;
        result.set(`${r.checked} script${r.checked === 1 ? "" : "s"} checked: ${r.broken ? `${r.broken} broken` : "none broken"}. The report is in ${r.report}.`, r.broken ? "bad" : "good");
        out.append(reportBlock("Release check report", r.text));
      })),
      result.el, out,
    );
  },
};
