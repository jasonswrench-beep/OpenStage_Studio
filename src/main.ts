// OpenStage Studio's window: check a tutorial script against the format, and review a finished video (the review gate)
// before its publishing package is exported. Making the video is done by "Make Video.bat" in this version (see
// docs/HANDOFF.md); the window gains that button when the player moves into the app.

import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { describeAction } from "./captions/captions.ts";
import { describeProblems, validateScript } from "./script/validate.ts";
import { showReview } from "./review/view.ts";
import "./style.css";

const app = document.createElement("div");
app.className = "studio";
app.innerHTML = `
<header class="bar">
  <img src="/studio-icon.svg" alt="" class="logo">
  <h1>OpenStage Studio</h1>
  <button type="button" id="open">Check a script</button>
  <button type="button" id="review">Review a video</button>
</header>
<p id="status" class="status" role="status" aria-live="polite"></p>
<main id="main"></main>`;
document.body.append(app);

const main = document.querySelector<HTMLElement>("#main")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const announce = (text: string) => {
  // Cleared first so the same message said twice is still read out.
  status.textContent = "";
  setTimeout(() => (status.textContent = text), 60);
};

function showCheck() {
  main.className = "two";
  main.innerHTML = `
  <section aria-labelledby="result-h">
    <h2 id="result-h">Script check</h2>
    <p id="summary" tabindex="-1">Open a tutorial script (a .json file) to check it. Nothing is changed by checking.</p>
    <ul id="problems" class="problems"></ul>
  </section>
  <section aria-labelledby="steps-h">
    <h2 id="steps-h">Steps</h2>
    <ol id="steps" class="steps"></ol>
  </section>`;
}

function show(fileName: string, text: string) {
  showCheck();
  const summary = document.querySelector<HTMLParagraphElement>("#summary")!;
  const problems = document.querySelector<HTMLUListElement>("#problems")!;
  const steps = document.querySelector<HTMLOListElement>("#steps")!;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    summary.textContent = `${fileName} is not valid JSON: ${(e as Error).message}`;
    summary.focus();
    return;
  }
  const v = validateScript(parsed);
  summary.textContent = v.ok
    ? `${fileName} passes the check${v.warnings.length ? `, with ${v.warnings.length} warning${v.warnings.length === 1 ? "" : "s"}` : ""}. ${v.rehearsable ? "Every step says what must be true afterward." : "Some steps do not say what must be true afterward yet, so it cannot count as rehearsed."} The script scan for blocked names runs when the video is made.`
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
  summary.focus();
}

document.querySelector("#open")!.addEventListener("click", async () => {
  const path = await open({ multiple: false, filters: [{ name: "Tutorial script", extensions: ["json"] }] });
  if (typeof path !== "string") return;
  const name = path.split(/[\\/]/).pop() ?? path;
  try {
    show(name, await readTextFile(path));
  } catch (e) {
    announce(`${name} could not be read: ${String(e)}`);
  }
});

async function review(folder: string) {
  main.className = "one";
  try {
    await showReview(main, folder, announce);
  } catch (e) {
    main.innerHTML = "";
    const p = document.createElement("p");
    p.tabIndex = -1;
    p.textContent = `That folder could not be opened for review: ${e instanceof Error ? e.message : String(e)}. Choose the folder a video was made in (in renders), which holds its review.json.`;
    main.append(p);
    p.focus();
  }
}

document.querySelector("#review")!.addEventListener("click", async () => {
  const folder = await open({ directory: true, recursive: true, title: "Choose the folder a video was made in (in renders)" });
  if (typeof folder === "string") await review(folder);
});

// Opened by "Review Video.bat": go straight to that video's review.
const asked = (globalThis as { __OPENSTAGE_REVIEW__?: string }).__OPENSTAGE_REVIEW__;
if (asked) void review(asked);
else showCheck();
