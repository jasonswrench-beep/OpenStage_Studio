// The job area, on every page: what is running now, in words, a Cancel button, and every message of the last job. The
// line that says what is happening is a polite live region, updated at most every few seconds, so a screen reader is not
// flooded while a video assembles; the start and the end of a job are always said at once.

import { cancelJob, onJob } from "./engine.ts";
import { el } from "./ui.ts";

const THROTTLE_MS = 4000;

export function jobArea(): HTMLElement {
  const now = el("p", { className: "job-now", role: "status" }, "No job is running.");
  const cancel = el("button", { type: "button", className: "quiet", hidden: true }, "Cancel the job");
  const count = el("span", {}, "0");
  const log = el("ol", { className: "job-log" });
  const details = el("details", {}, el("summary", {}, "Every message of the last job (", count, ")"), log);
  const area = el("section", { className: "job", "aria-labelledby": "job-h" }, el("h2", { id: "job-h", className: "visually-hidden" }, "Job"), el("div", { className: "job-row" }, now, cancel), details);

  let pending: string | null = null;
  let timer: number | null = null;
  let lastSaid = 0;
  const say = (text: string, atOnce = false) => {
    pending = text;
    const wait = atOnce ? 0 : Math.max(0, lastSaid + THROTTLE_MS - Date.now());
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      if (pending === null) return;
      now.textContent = pending;
      pending = null;
      lastSaid = Date.now();
    }, wait);
  };

  cancel.addEventListener("click", async () => {
    cancel.disabled = true;
    say("Cancelling...", true);
    await cancelJob();
  });

  onJob((e) => {
    if (e.kind === "start") {
      log.replaceChildren();
      count.textContent = "0";
      cancel.hidden = false;
      cancel.disabled = false;
      area.classList.add("running");
      say(`${e.label}: started.`, true);
    } else if (e.kind === "log" && e.text) {
      log.append(el("li", {}, e.text));
      count.textContent = String(log.children.length);
      say(`${e.label}: ${e.text}`);
    } else if (e.kind === "end") {
      cancel.hidden = true;
      area.classList.remove("running");
      if (e.text) {
        log.append(el("li", {}, e.text));
        count.textContent = String(log.children.length);
      }
      // A button that disappears while focused would leave the focus nowhere: put it on the job line instead.
      if (document.activeElement === cancel || document.activeElement === document.body) {
        now.tabIndex = -1;
        now.focus();
      }
      say(e.cancelled ? `${e.label}: cancelled.` : e.ok ? `${e.label}: done.` : `${e.label}: did not finish. ${e.text ?? ""}`, true);
    }
  });
  return area;
}
