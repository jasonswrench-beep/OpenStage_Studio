// Settings for this computer: where a person's work goes, which display takes use, where OpenStage Author's program is,
// and their own blocklist of names that must never appear in a video.

import type { Page } from "../context.ts";
import { allowWorkspace } from "../engine.ts";
import { button, el, heading, resultLine, selectField, textField } from "../ui.ts";
import { act, chooseFile, chooseFolder } from "./common.ts";

export const settings: Page = {
  id: "settings",
  name: "Settings",
  async show(host, ctx) {
    const s = await ctx.status();
    const result = resultLine();
    const work = textField("Your work folder", { value: s.workspace, wide: true, hint: "Videos, series, packages and your blocklist are kept here." });
    const screen = selectField("The take screen: the display videos are recorded on", [1, 2, 3, 4].map((n) => ({ value: String(n), text: n === 1 ? "Display 1 (the main one)" : `Display ${n}` })), String(s.monitor));
    const author = textField("OpenStage Author's program (only if it is not found by itself)", { value: s.authorExe ?? "", wide: true, hint: s.authorExe ? "Found." : "Not found. Leave this empty unless you have it somewhere unusual." });
    const blockResult = resultLine();

    const workPart = s.installed
      ? [work.wrap, el("div", { className: "actions" }, button("Choose the work folder…", async () => {
        const f = await chooseFolder("Choose your work folder");
        if (f) work.input.value = f;
      }, { quiet: true }))]
      : [el("p", {}, `Run from the repository, your work is kept in the repository itself (${s.workspace}).`)];
    host.append(
      heading("Settings"),
      el("p", {}, "These settings are for this computer only."),
      ...workPart,
      screen.wrap,
      el("p", { className: "muted" }, "Recording a video takes that display over, full screen. A second display keeps your main one free while it records."),
      author.wrap,
      el("div", { className: "actions" }, button("Choose OpenStage Author's program…", async () => {
        const f = await chooseFile("Choose OpenStage Author's program", "Program", ["exe"]);
        if (f) author.input.value = f;
      }, { quiet: true })),
      el("div", { className: "actions" }, button("Save the settings", async () => {
        const r = await act<{ workspace: string; monitor: number }>(result, "Saving the settings", "set-settings", { ...(s.installed ? { workspace: work.input.value } : {}), monitor: Number(screen.select.value), authorExe: author.input.value });
        if (!r) return;
        await allowWorkspace();
        result.set(`Saved. Your work goes into ${r.workspace}; videos are recorded on display ${r.monitor}.`, "good");
      })),
      result.el,
      el("h3", {}, "Your blocklist"),
      el("p", {}, "Names that must never appear in a video (another company's products, real people, institutions) go in your own blocklist, in your work folder. It stays on this computer. The scans also look for this computer's user name, home folder and name by themselves."),
      el("div", { className: "actions" }, button("Start or find my blocklist", async () => {
        const r = await act<{ path: string; made: boolean }>(blockResult, "Finding your blocklist", "start-blocklist");
        if (r) blockResult.set(r.made ? `Started your blocklist: ${r.path}. Open it in a text editor and add names under each category.` : `Your blocklist is ${r.path}. Open it in a text editor to add names.`, "good");
      }, { quiet: true })),
      blockResult.el,
    );
  },
};
