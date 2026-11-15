// OpenStage Studio's window. A list of pages on the left (Home, Make a video, Review, From a manual, Queue, Release
// check, AI, Connector, Settings), the page itself, and the job area, which says what is running on every page. Each
// page's work is done by the engine (src/engine/main.ts), the same code the double-click files run.
//
// Keyboard: Tab moves through the page list, then the page, then the job area. Opening a page puts the focus on its
// heading. Nothing traps the focus, and every state is said in words as well as shown.

import { allowWorkspace } from "./app/engine.ts";
import { fetchLibrary, fetchStatus, type Ctx, type Page } from "./app/context.ts";
import { jobArea } from "./app/job-area.ts";
import { el, errorText, heading } from "./app/ui.ts";
import { home } from "./app/pages/home.ts";
import { make } from "./app/pages/make.ts";
import { review } from "./app/pages/review.ts";
import { manual } from "./app/pages/manual.ts";
import { queue, release } from "./app/pages/batch.ts";
import { ai } from "./app/pages/ai.ts";
import { connector } from "./app/pages/connector.ts";
import { settings } from "./app/pages/settings.ts";
import "./style.css";

const PAGES: Page[] = [home, make, review, manual, queue, release, ai, connector, settings];

const status = el("p", { id: "status", className: "status", role: "status" });
const say = (text: string) => {
  // Cleared first so the same message said twice is still read out.
  status.textContent = "";
  setTimeout(() => (status.textContent = text), 60);
};

const main = el("main", { id: "main", tabIndex: -1 });
const navButtons = new Map<string, HTMLButtonElement>();
const nav = el("nav", { "aria-label": "Pages" }, el("ul", {}, ...PAGES.map((p) => {
  const b = el("button", { type: "button", className: "nav" }, p.name);
  b.addEventListener("click", () => go(p.id));
  navButtons.set(p.id, b);
  return el("li", {}, b);
})));

document.body.append(
  el("a", { href: "#main", className: "skip" }, "Skip to the page"),
  el("header", { className: "bar" }, el("img", { src: "/studio-icon.svg", alt: "", className: "logo" }), el("h1", {}, "OpenStage Studio")),
  status,
  el("div", { className: "layout" }, nav, el("div", { className: "content" }, main, jobArea())),
);
document.querySelector<HTMLAnchorElement>(".skip")!.addEventListener("click", (e) => {
  e.preventDefault();
  (main.querySelector<HTMLElement>(".page-h") ?? main).focus();
});

let showing = 0;
async function go(id: string, arg?: unknown) {
  const page = PAGES.find((p) => p.id === id) ?? home;
  const mine = ++showing;
  for (const [pid, b] of navButtons) {
    if (pid === page.id) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  document.title = `${page.name}: OpenStage Studio`;
  const host = el("div", { className: "page" });
  main.replaceChildren(el("p", { className: "muted" }, `Opening ${page.name}...`));
  const ctx: Ctx = { go: (p, a) => void go(p, a), say, arg, status: fetchStatus, library: fetchLibrary };
  try {
    await page.show(host, ctx);
  } catch (e) {
    host.replaceChildren(heading(page.name), el("p", {}, `This page could not be opened: ${errorText(e)}`));
  }
  if (mine !== showing) return; // Another page was asked for meanwhile.
  main.replaceChildren(host);
  host.querySelector<HTMLElement>(".page-h")?.focus();
}

// Opened by "Review Video.bat" (or with --review): go straight to that video's review.
const asked = (globalThis as { __OPENSTAGE_REVIEW__?: string }).__OPENSTAGE_REVIEW__;
allowWorkspace().catch((e) => say(`Your work folder could not be opened: ${errorText(e)}`)).finally(() => void (asked ? go("review", { folder: asked }) : go("home")));
