// OpenStage Studio's window, first version: open a tutorial script, check it against the format, and read its steps.
// Making the video is done by "Make Video.bat" in this version (see docs/HANDOFF.md); the window gains that button when
// the player moves into the app.

import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { describeAction } from "./captions/captions.ts";
import { describeProblems, validateScript } from "./script/validate.ts";
import "./style.css";

const app = document.createElement("div");
app.className = "studio";
app.innerHTML = `
<header class="bar">
  <img src="/studio-icon.svg" alt="" class="logo">
  <h1>OpenStage Studio</h1>
  <button type="button" id="open">Open a script</button>
</header>
<main>
  <section aria-labelledby="result-h">
    <h2 id="result-h">Script check</h2>
    <p id="summary">Open a tutorial script (a .json file) to check it. Nothing is changed by checking.</p>
    <ul id="problems" class="problems"></ul>
  </section>
  <section aria-labelledby="steps-h">
    <h2 id="steps-h">Steps</h2>
    <ol id="steps" class="steps"></ol>
  </section>
</main>`;
document.body.append(app);

const summary = document.querySelector<HTMLParagraphElement>("#summary")!;
const problems = document.querySelector<HTMLUListElement>("#problems")!;
const steps = document.querySelector<HTMLOListElement>("#steps")!;

function show(fileName: string, text: string) {
  problems.innerHTML = "";
  steps.innerHTML = "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    summary.textContent = `${fileName} is not valid JSON: ${(e as Error).message}`;
    return;
  }
  const v = validateScript(parsed);
  summary.textContent = v.ok
    ? `${fileName} passes the check${v.warnings.length ? `, with ${v.warnings.length} warning${v.warnings.length === 1 ? "" : "s"}` : ""}. ${v.rehearsable ? "Every step says what must be true afterward." : "Some steps do not say what must be true afterward yet, so it cannot count as rehearsed."}`
    : `${fileName} does not pass the check: ${v.errors.length} error${v.errors.length === 1 ? "" : "s"}. The player will not run it until they are fixed.`;
  for (const line of describeProblems(v)) {
    const li = document.createElement("li");
    li.textContent = line;
    problems.append(li);
  }
  if (v.script) {
    for (const s of v.script.steps) {
      const li = document.createElement("li");
      const what = document.createElement("strong");
      what.textContent = describeAction(s);
      const said = document.createElement("span");
      said.textContent = s.silent ? " (silent)" : ` "${s.narration}"`;
      li.append(what, said);
      steps.append(li);
    }
  }
}

document.querySelector("#open")!.addEventListener("click", async () => {
  const path = await open({ multiple: false, filters: [{ name: "Tutorial script", extensions: ["json"] }] });
  if (typeof path !== "string") return;
  const name = path.split(/[\\/]/).pop() ?? path;
  try {
    show(name, await readTextFile(path));
  } catch (e) {
    summary.textContent = `${name} could not be read: ${String(e)}`;
  }
  summary.focus();
});
summary.tabIndex = -1;
