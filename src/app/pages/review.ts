// Review: the videos made in the work folder, each with where its review stands, in words. Opening one shows the review
// gate (src/review/view.ts), where a person resolves each flag, approves the video and exports its package. Every
// approved video can also be exported at once, with the upload checklist.

import { showReview } from "../../review/view.ts";
import type { Page } from "../context.ts";
import { button, el, errorText, heading, resultLine } from "../ui.ts";
import { act, chooseFolder } from "./common.ts";

export const review: Page = {
  id: "review",
  name: "Review",
  async show(host, ctx) {
    const asked = (ctx.arg as { folder?: string } | undefined)?.folder;
    if (asked) {
      try {
        const back = button("Back to the list of videos", () => ctx.go("review"), { quiet: true });
        const inner = el("div");
        host.append(back, inner);
        await showReview(inner, asked, ctx.say);
        inner.querySelector<HTMLElement>("h2")?.classList.add("page-h");
      } catch (e) {
        host.replaceChildren(heading("Review"), el("p", {}, `That folder could not be opened for review: ${errorText(e)}. Choose the folder a video was made in (in renders), which holds its review.json.`));
      }
      return;
    }
    const lib = await ctx.library();
    const result = resultLine();
    const rows = lib.videos.map((v) =>
      el("li", {},
        el("strong", {}, v.name), " ",
        el("span", { className: v.open ? "state approved" : "state open" }, v.open ? "✓ " : "", v.reviewed ? v.says : "It has no review yet."), " ",
        v.reviewed ? button(`Review ${v.name}`, () => ctx.go("review", { folder: v.folder }), { quiet: true }) : null));
    const approved = lib.videos.filter((v) => v.open);
    const exportAll = button(`Export every approved video (${approved.length})`, async () => {
      if (!approved.length) return result.set("No video is approved yet. Review one and approve it first.", "bad");
      const r = await act<{ out: string; exported: string[]; refused: { folder: string; why: string }[] }>(result, "Exporting the approved videos", "export", { folders: approved.map((v) => v.folder) });
      if (r) result.set(`Exported ${r.exported.length} package${r.exported.length === 1 ? "" : "s"} into ${r.out}, with the upload checklist.${r.refused.length ? ` ${r.refused.length} could not go: see the job's messages.` : ""}`, r.refused.length ? "bad" : "good");
    });
    host.append(
      heading("Review"),
      el("p", {}, "Watch each video, resolve every flag the scans raised, and approve it. Only an approved video, unchanged since it was reviewed, can be exported."),
      lib.videos.length ? el("ul", { className: "videos" }, ...rows) : el("p", {}, "No videos have been made in your work folder yet."),
      el("div", { className: "actions" },
        button("Open a video's folder…", async () => {
          const f = await chooseFolder("Choose the folder a video was made in (in renders)");
          if (f) ctx.go("review", { folder: f });
        }, { quiet: true }),
        exportAll),
      result.el,
    );
  },
};
