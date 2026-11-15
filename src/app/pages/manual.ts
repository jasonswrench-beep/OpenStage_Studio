// From a manual: the AI plans videos from one chapter, a person approves or cuts each, the AI writes the approved ones'
// scripts, and rehearsal checks them in the real program. Every step leaves plain files in the series folder that a
// person can read and edit (docs/ai.md); nothing is recorded here.

import type { Page } from "../context.ts";
import type { Plan } from "../../ai/series.ts";
import { button, el, heading, resultLine, selectField, textField } from "../ui.ts";
import { act, chooseFile, fileName } from "./common.ts";
import { ask } from "../engine.ts";

const STATUS_WORDS = { proposed: "Proposed (not decided)", approved: "Approved: write its script", cut: "Cut: leave it out" } as const;

export const manual: Page = {
  id: "manual",
  name: "From a manual",
  async show(host, ctx) {
    const [s, lib] = await Promise.all([ctx.status(), ctx.library()]);
    const asked = (ctx.arg as { series?: string } | undefined)?.series;
    const result = resultLine();
    host.append(heading("From a manual"));
    if (s.ai.choice === "none") host.append(el("p", { className: "panel" }, "Studio has no AI chosen, so it cannot plan or write scripts. Choose one on the AI page, or write scripts by hand (docs/script-format.md).", " ", button("Choose an AI", () => ctx.go("ai"), { quiet: true })));
    else host.append(el("p", {}, `Studio uses ${s.ai.says}. Everything it writes is a file you can read and change before anything is recorded.`));

    // 1. Plan.
    let manualPath = "";
    const manualLine = el("p", { id: "manual-line" }, "No manual chosen yet.");
    const chapter = textField("Chapter (its number or words from its title; empty for the first)", { hint: "For example 3, or Lessons." });
    const program = selectField("The program the manual is about", [{ value: "", text: "Found from the manual" }, ...s.programs.map((p) => ({ value: p.id, text: p.name }))]);
    const plan = button("Plan the videos", async () => {
      if (!manualPath) return result.set("Choose a manual first.", "bad");
      const r = await act<{ folder: string }>(result, "Planning the videos", "plan-series", { manual: manualPath, chapter: chapter.input.value, program: program.select.value });
      if (r) ctx.go("manual", { series: r.folder });
    });
    host.append(el("h3", {}, "1. Plan videos from a chapter"),
      el("div", { className: "actions" }, button("Choose a manual…", async () => {
        const p = await chooseFile("Choose a manual", "Manual (an OpenStage Author project or a PDF)", ["openexplainer", "pdf"]);
        if (p) {
          manualPath = p;
          manualLine.textContent = `Manual: ${fileName(p)}`;
        }
      }, { quiet: true })), manualLine, chapter.wrap, program.wrap, el("div", { className: "actions" }, plan));

    // 2. A series: its plan, the choices, writing and rehearsing.
    const series = selectField("Series", lib.series.map((f) => ({ value: f, text: fileName(f) })), asked ?? lib.series[0]);
    const holder = el("div");
    host.append(el("h3", {}, "2. Choose, write and rehearse"), lib.series.length ? series.wrap : el("p", {}, "No series yet: plan one above."), holder, result.el);

    const showSeries = async (folder: string) => {
      holder.replaceChildren();
      if (!folder) return;
      const { plan: p } = await ask<{ plan: Plan }>("series-plan", { folder });
      const picks = p.videos.map((v) => ({ v, pick: selectField(`Video ${v.position}: ${v.title}`, (["approved", "cut", "proposed"] as const).map((k) => ({ value: k, text: STATUS_WORDS[k] })), v.status) }));
      const rehearsed = (v: Plan["videos"][number]) => (v.rehearsal === "passed" ? "✓ passed rehearsal" : v.rehearsal === "failed" ? "✗ failed rehearsal" : v.script ? "written, not rehearsed" : "no script yet");
      holder.append(
        el("p", {}, `${p.manual.title}, chapter "${p.manual.chapter}", for ${p.program.name}. Planned by ${p.writtenBy.name}. The playlist: ${p.playlist}.`),
        el("ul", { className: "plan" }, ...picks.map(({ v, pick }) => el("li", {}, pick.wrap, el("p", { className: "muted" }, `${v.goal} Script: ${rehearsed(v)}.`)))),
        el("div", { className: "actions" },
          button("Save my choices", async () => {
            const statuses = Object.fromEntries(picks.map(({ v, pick }) => [v.id, pick.select.value]));
            const r = await act<{ approved: number }>(result, "Saving the choices", "series-choose", { folder, statuses });
            if (r) result.set(`Saved: ${r.approved} of ${p.videos.length} videos approved.`, "good");
          }),
          button("Write the approved videos' scripts", async () => {
            const r = await act<{ written: number }>(result, "Writing the scripts", "write-series", { folder });
            if (r) {
              result.set(`Wrote ${r.written} script${r.written === 1 ? "" : "s"}. Read them, then rehearse them.`, "good");
              await showSeries(folder);
            }
          }),
          button("Rehearse the scripts", async () => {
            const r = await act<{ passed: number; total: number; report: string }>(result, "Rehearsing the scripts", "rehearse-series", { folder });
            if (r) {
              result.set(`${r.passed} of ${r.total} scripts passed rehearsal. The report is in ${r.report}.`, r.passed === r.total ? "good" : "bad");
              await showSeries(folder);
            }
          }, { quiet: true })),
        el("p", { className: "muted" }, `The plan and scripts are in ${folder}. Rehearsal opens the program on display ${s.monitor}; scripts that pass can be made into videos on the Make a video page or by the queue.`),
      );
    };
    series.select.addEventListener("change", () => void showSeries(series.select.value));
    if (lib.series.length) await showSeries(series.select.value);
  },
};
