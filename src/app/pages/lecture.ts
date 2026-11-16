// Lecture: notes or a manual's chapter become a lecture script (slides and narration), which a person reads, approves
// and makes into a video: slides drawn by Studio, narration, captions, a description track and an MP4
// (docs/lecture-format.md). The video's review and export are the same as a tutorial's.

import type { Page } from "../context.ts";
import { ask } from "../engine.ts";
import { button, checkbox, el, heading, resultLine, selectField, textField } from "../ui.ts";
import { act, chooseFile, fileName } from "./common.ts";

interface Info {
  file: string;
  title: string;
  goal: string;
  writtenBy: { kind: string; name?: string } | null;
  problems: string[];
  approved: { ok: boolean; says: string };
  slides: { title: string; points: string[]; narration: string; picture: string | null }[];
}

const NAME_KEY = "openstage-studio.reviewer";
const storedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
};

export const lecture: Page = {
  id: "lecture",
  name: "Lecture",
  async show(host, ctx) {
    const [s, lib] = await Promise.all([ctx.status(), ctx.library()]);
    const asked = (ctx.arg as { file?: string } | undefined)?.file;
    const result = resultLine();

    // 1. Write one.
    let source = "";
    const sourceLine = el("p", {}, "No notes or manual chosen yet.");
    const chapter = textField("Chapter, for a manual (its number or words from its title; empty for the first)");
    const useAi = checkbox(`Write it with the AI (${s.ai.says})`, s.ai.choice !== "none");
    if (s.ai.choice === "none") useAi.input.disabled = true;
    const write = button("Write the lecture", async () => {
      if (!source) return result.set("Choose notes or a manual first.", "bad");
      const r = await act<{ file: string; slides: number; ai: string; warnings: string[] }>(result, "Writing the lecture", "write-lecture", { source, chapter: chapter.input.value, useAi: useAi.input.checked });
      if (r) ctx.go("lecture", { file: r.file });
    });

    // 2. Read, approve, make.
    const options = lib.lectures.map((l) => ({ value: l.file, text: `${l.title} (${l.slides} slides, ${fileName(l.file)})` }));
    if (asked && !options.some((o) => o.value === asked)) options.unshift({ value: asked, text: fileName(asked) });
    const pick = selectField("Lecture", options, asked ?? options[0]?.value);
    const holder = el("div");
    const showInfo = async (file: string) => {
      holder.replaceChildren();
      if (!file) return;
      const info = await ask<Info>("lecture-info", { file });
      const name = textField("Your name (the approval records it)", { value: storedName(), autocomplete: "name" });
      name.input.addEventListener("change", () => {
        try {
          localStorage.setItem(NAME_KEY, name.input.value.trim());
        } catch {
          // Remembering the name is a convenience only.
        }
      });
      const approveBtn = button("Approve this lecture", async () => {
        if (!name.input.value.trim()) return result.set("Type your name first: the approval records who approved it.", "bad");
        const r = await act<{ by: string }>(result, "Approving the lecture", "approve-lecture", { file, by: name.input.value });
        if (r) {
          result.set(`Approved by ${r.by}. Any change to its words needs a new approval.`, "good");
          await showInfo(file);
        }
      });
      const makeBtn = button("Make the video", async () => {
        const made = await act<{ folder: string; video: string; seconds: number; flags: number }>(result, "Making the lecture video", "make-lecture", { file });
        if (!made) return;
        result.set(`Made ${fileName(made.video)}: ${made.seconds} seconds. ${made.flags ? `The scans raised ${made.flags} flag${made.flags === 1 ? "" : "s"}.` : "The scans raised no flags."} Review it before it is exported.`, "good");
        const review = button("Review it", () => ctx.go("review", { folder: made.folder }));
        holder.append(el("div", { className: "actions" }, review));
        review.focus();
      }, { describedBy: "approval-state" });
      const state = el("p", { id: "approval-state", className: info.approved.ok ? "state approved" : "state open" }, info.approved.ok ? "✓ " : "✗ ", info.approved.says);
      holder.append(
        el("p", {}, `${info.title}. ${info.goal} ${info.writtenBy ? `Written by ${info.writtenBy.name ?? info.writtenBy.kind}.` : ""}`),
        info.problems.length ? el("ul", { className: "problems" }, ...info.problems.map((p) => el("li", {}, p))) : el("p", {}, "It passes the check."),
        el("h3", {}, `Its ${info.slides.length} slides`),
        el("ol", { className: "steps" }, ...info.slides.map((sl) => el("li", {},
          el("strong", {}, sl.title), sl.points.length ? el("ul", {}, ...sl.points.map((p) => el("li", {}, p))) : null,
          sl.picture ? el("p", { className: "muted" }, `Picture: ${sl.picture}`) : null,
          el("p", { className: "muted" }, `Said: ${sl.narration}`)))),
        el("p", { className: "muted" }, `To change it, open ${info.file} in a text editor, then come back here: the page reads it again.`),
        el("h3", {}, "Approve and make"), state, name.wrap,
        el("div", { className: "actions" }, approveBtn, button("Read it again", () => showInfo(file), { quiet: true }), makeBtn),
      );
    };
    pick.select.addEventListener("change", () => void showInfo(pick.select.value));

    host.append(
      heading("Lecture"),
      el("p", {}, "A lecture is slides and narration made from your notes or a chapter of a manual. You read and approve the lecture script; Studio then draws the slides, speaks the narration and makes the video, with captions, a description track and a transcript."),
      el("h3", {}, "1. Write a lecture"),
      el("div", { className: "actions" }, button("Choose notes or a manual…", async () => {
        const f = await chooseFile("Choose notes (.md or .txt) or a manual", "Notes or manual", ["md", "txt", "openexplainer", "pdf"]);
        if (f) {
          source = f;
          sourceLine.textContent = `From: ${fileName(f)}`;
        }
      }, { quiet: true })),
      sourceLine, chapter.wrap, useAi.wrap, el("div", { className: "actions" }, write),
      el("h3", {}, "2. Read, approve and make the video"),
      options.length ? pick.wrap : el("p", {}, "No lectures yet: write one above."),
      holder, result.el,
    );
    if (options.length) await showInfo(pick.select.value);
  },
};
