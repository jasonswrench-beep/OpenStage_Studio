// AI: no AI, the built-in model on this computer, or a hosted service with the person's own key. The key is typed into a
// field that does not show it, handed to the engine on its standard input, kept only in this computer's settings, and
// never shown again (the page only says whether one is saved).

import type { Page } from "../context.ts";
import { button, checkbox, choiceGroup, el, heading, resultLine, textField } from "../ui.ts";
import { act } from "./common.ts";

export const ai: Page = {
  id: "ai",
  name: "AI",
  async show(host, ctx) {
    const s = await ctx.status();
    const result = resultLine();
    const current = s.ai.choice === "hosted" ? s.ai.preset ?? "" : s.ai.choice;
    const group = choiceGroup("Which AI Studio uses to plan, write and repair scripts", [
      { value: "none", text: "No AI", hint: "(write scripts by hand)" },
      { value: "builtin", text: "The built-in model on this computer", hint: s.builtinAi.ready ? "(downloaded; nothing leaves the computer)" : `(nothing leaves the computer; a ${s.builtinAi.left} download, once)` },
      ...s.presets.map((p) => ({ value: p.id, text: `${p.name}, with your own key` })),
    ], current);

    // The built-in model's download.
    const builtinNote = el("p", { id: "builtin-note", className: "muted" }, `${s.builtinAi.name}. Licences: ${s.builtinAi.licence}. It downloads ${s.builtinAi.left}, once, into ${s.builtinAi.folder}, and runs on this computer only.`);
    const download = button(`Download the built-in model (${s.builtinAi.left})`, async () => {
      if (await act(result, "Downloading the built-in model", "get-ai")) {
        result.set("The built-in model is downloaded and checked. Choose it above and save.", "good");
        ctx.go("ai");
      }
    }, { describedBy: "builtin-note" });
    const builtin = el("div", { className: "panel" }, builtinNote, s.builtinAi.ready ? el("p", {}, "✓ Downloaded.") : download);

    // A hosted service's details.
    const same = (id: string) => s.ai.choice === "hosted" && s.ai.preset === id;
    const model = textField("The model's name");
    const address = textField("The service's chat-completions address", { hint: "Starting with https://", wide: true, value: s.ai.address ?? "" });
    const pictures = checkbox("The service can be shown pictures", s.ai.pictures === true);
    const key = textField("Your key for the service", { type: "password", hint: "" });
    const keyHint = key.wrap.querySelector<HTMLElement>(".muted")!;
    const hosted = el("div", { className: "panel" }, el("p", {}, s.hostedNote), model.wrap, address.wrap, pictures.wrap, key.wrap);

    const draw = () => {
      const v = group.value();
      const p = s.presets.find((x) => x.id === v);
      builtin.hidden = v !== "builtin";
      hosted.hidden = !p;
      if (!p) return;
      address.wrap.hidden = !p.custom;
      pictures.wrap.hidden = !p.custom;
      model.input.value = (same(p.id) ? s.ai.model : null) ?? p.defaultModel ?? "";
      key.input.value = "";
      keyHint.textContent = same(p.id) && s.ai.hasKey ? "A key is saved. Leave this empty to keep it." : p.custom ? "If the service needs one." : "It is kept on this computer only and sent only to this service.";
    };
    group.inputs.forEach((i) => i.addEventListener("change", draw));
    draw();

    const save = button("Save and try it", async () => {
      const v = group.value();
      const p = s.presets.find((x) => x.id === v);
      const typed = key.input.value;
      // The key leaves the field at once; it goes to the engine's input only.
      key.input.value = "";
      const args = p
        ? { choice: "hosted", preset: p.id, model: model.input.value, ...(p.custom ? { address: address.input.value, pictures: pictures.input.checked } : {}), keyOnInput: true }
        : { choice: v };
      const r = await act<{ says: string }>(result, "Saving the AI choice", "set-ai", args, p ? typed : undefined);
      if (r) result.set(`Saved: Studio uses ${r.says}.${v === "none" ? "" : " It answered the test question."}`, "good");
    });
    const test = button("Try it again", async () => {
      const r = await act<{ answer: string }>(result, "Trying the AI", "test-ai");
      if (r) result.set(`It works. It answered: ${r.answer}`, "good");
    }, { quiet: true });

    host.append(
      heading("AI"),
      el("p", {}, `Studio uses ${s.ai.says} now. AI is optional: it plans and writes scripts and proposes repairs, never records or approves a video.`),
      group.wrap, builtin, hosted,
      el("div", { className: "actions" }, save, s.ai.choice === "none" ? null : test),
      result.el,
    );
  },
};
