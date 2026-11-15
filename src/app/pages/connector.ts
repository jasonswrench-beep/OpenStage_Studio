// Connector: let an assistant a person uses (through the connector, MCP) read manuals and programs' controls, write
// tutorial scripts into one folder, and rehearse them. Off until turned on here; it can never record, approve or export a
// video (docs/connector.md).

import type { Page } from "../context.ts";
import { ask } from "../engine.ts";
import { button, choiceGroup, el, heading, reportBlock, resultLine, textField } from "../ui.ts";
import { act, chooseFolder } from "./common.ts";

interface Lines {
  command: string;
  args: string[];
  block: string;
}

export const connector: Page = {
  id: "connector",
  name: "Connector",
  async show(host, ctx) {
    const s = await ctx.status();
    const result = resultLine();
    const onOff = choiceGroup("The connector", [
      { value: "on", text: "On, for one folder" },
      { value: "off", text: "Off", hint: "(an assistant that tries it is told it is off)" },
    ], s.connector.on ? "on" : "off");
    const folder = textField("The one folder an assistant may use", { value: s.connector.folder ?? `${s.workspace}\\Connector`, wide: true, hint: "Put the manuals you want scripts for in it. Studio makes it if it does not exist." });
    const lines = el("div");
    const showLines = (l: Lines) =>
      lines.replaceChildren(
        el("h3", {}, "Connecting an assistant"),
        el("p", {}, "For an assistant that reads its servers from a settings file, add this block to that file:"),
        reportBlock("Settings-file block", l.block),
        el("div", { className: "actions" }, button("Copy the block", async () => {
          try {
            await navigator.clipboard.writeText(l.block);
            result.set("Copied.", "good");
          } catch {
            result.set("It could not be copied; select the text above and copy it.", "bad");
          }
        }, { quiet: true })),
        el("p", {}, "For an assistant that asks for the command that starts a server:"),
        el("dl", { className: "facts" }, el("dt", {}, "Command"), el("dd", {}, l.command), el("dt", {}, "Arguments"), el("dd", {}, l.args.join(" "))),
      );
    const draw = () => (folder.wrap.hidden = onOff.value() !== "on");
    onOff.inputs.forEach((i) => i.addEventListener("change", draw));
    draw();

    host.append(
      heading("Connector"),
      el("p", {}, "With the connector on, an assistant you use can read the manuals in one folder and the programs' controls, write tutorial scripts into that folder, and rehearse them on your take screen. It cannot record, approve or export a video, and cannot see anything outside the folder."),
      onOff.wrap, folder.wrap,
      el("div", { className: "actions" },
        button("Choose the folder…", async () => {
          const f = await chooseFolder("Choose the folder an assistant may use");
          if (f) folder.input.value = f;
        }, { quiet: true }),
        button("Save", async () => {
          const on = onOff.value() === "on";
          const r = await act<{ on: boolean; folder?: string } & Partial<Lines>>(result, "Saving the connector setting", "set-connector", { on, folder: folder.input.value });
          if (!r) return;
          result.set(r.on ? `The connector is on, for ${r.folder} only.` : "The connector is off.", "good");
          if (r.on && r.block) showLines(r as unknown as Lines);
          else lines.replaceChildren();
        })),
      result.el, lines,
    );
    if (s.connector.on) showLines(await ask<Lines>("connector-lines"));
  },
};
