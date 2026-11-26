// The demo-mode hook: a small library a program includes so OpenStage Studio can perform scripts in it.
//
// * Off by default. It starts only when the program was launched with the demo flag (its shell then sets the settings
//   global, see protocol.ts), and it only ever talks to this computer.
// * Controls are found by stable names, never by their visible labels: mark each one with `data-demo-id`, as in
//   `<button data-demo-id="toolbar.lesson.new">New lesson</button>`. Rewording a button does not break any script.
// * It lists controls, reports where they are, clicks, types, presses keys, scrolls, loads a named demo project and
//   resets to a known state.
// * In demo mode the page holds still: the text caret does not blink and transitions are off, so a still picture of a
//   step always looks the same.
//
// Adding it to a program: import { startDemoHook } from "<path>/demo-hook/hook.ts" and call it once at start-up with the
// program's demo-project loader. See docs/demo-hook.md.

import {
  caretMove, findWords, HOOK_VERSION, readSettings, shownRect, steadySelector, type Command, type ControlInfo, type Envelope, type Hello, type HookSettings, type Reply,
  type TextOnScreen,
} from "./protocol.ts";

export interface DemoHookOptions {
  /** The program's name, for the player's log. */
  program: string;
  /** Open a demo project from the program's demo library, by name. */
  loadDemo(name: string): void | Promise<void>;
  /** Put the program back to a known state (no dialogs open, nothing selected). */
  reset(): void | Promise<void>;
  /** Settings to use instead of reading them from the page (for tests). */
  settings?: HookSettings;
  /** Whether the program still has work of its own to finish on a timer after a step (OpenStage Author checks the course for
   * problems a moment after each change). Settle waits until it has none, at most BUSY_MOST_MS, so the picture shows the result. */
  busy?(): boolean;
}

/** The longest settle waits for a program's own work (DemoHookOptions.busy). */
const BUSY_MOST_MS = 5000;

export interface DemoHook {
  stop(): void;
}

// In demo mode the page holds still and ignores the real mouse: a pointer resting over the window cannot give a control
// its hover look, and a stray click cannot spoil the take. The hook's own clicks are unaffected.
const STEADY_CSS = `
*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; scroll-behavior: auto !important; pointer-events: none !important; }
:focus-visible { outline-style: none; }
::selection { background-color: Highlight; color: HighlightText; }
select { will-change: transform; appearance: none !important; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 6l4.5 4.5L12.5 6' fill='none' stroke='%23444' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") !important; background-repeat: no-repeat !important; background-position: right 0.7em center !important; background-size: 1em !important; padding-right: 2.2em !important; }
`;
// Selected text is drawn grey when the window is not the active one and blue when it is, and which window is in front can change
// during a take, so in demo mode a selection always has the active look (2026-11-20: a selected word in Prism Transcribe's editor
// came out grey in one take and blue in the next).
// Windows draws some controls itself and draws them differently when the program's window is not the active one. A
// drop-down list is the one that shows in pictures, so in demo mode it is drawn by the page instead (the same box and
// colours, with a plain arrow), and its look no longer depends on which window is active.
// Each list is also drawn on a layer of its own (will-change), which fixes how its words are smoothed: otherwise the browser
// chose between plain grey and coloured fringes by itself, which made two takes differ.

/** A page the hook works in: the program's own page, or a frame inside it that comes from the program itself (the same
 * origin), such as a tools pane. `offset` is where the frame's top-left corner is on the program's page, and `clip` the
 * part of the program's page the frame shows through. Every place the hook reports is on the program's page. Frames from
 * other sites cannot be reached and are left out. */
interface Surface {
  doc: Document;
  offset: [number, number];
  clip: DOMRect;
}

type PageWindow = Window & typeof globalThis;

/** The window an element belongs to: the program's own, or a frame's. Each has its own kinds of element and event. */
function windowOf(el: Element): PageWindow {
  return (el.ownerDocument.defaultView ?? window) as PageWindow;
}

const isInput = (el: Element): el is HTMLInputElement => el instanceof windowOf(el).HTMLInputElement;
const isTextArea = (el: Element): el is HTMLTextAreaElement => el instanceof windowOf(el).HTMLTextAreaElement;
const isSelect = (el: Element): el is HTMLSelectElement => el instanceof windowOf(el).HTMLSelectElement;
const isButton = (el: Element): el is HTMLButtonElement => el instanceof windowOf(el).HTMLButtonElement;
/** A tick box or a radio button. */
const isTickable = (el: Element): el is HTMLInputElement => isInput(el) && (el.type === "checkbox" || el.type === "radio");
/** Controls of other kinds that Space chooses, by their role. */
const TICKABLE_ROLES = new Set(["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio", "option", "tab"]);

/** The program's page and every frame in it the hook can reach and that shows, outermost first. */
function surfaces(): Surface[] {
  const out: Surface[] = [];
  const visit = (doc: Document, offset: [number, number], clip: DOMRect) => {
    out.push({ doc, offset, clip });
    for (const frame of Array.from(doc.querySelectorAll<HTMLIFrameElement>("iframe, frame"))) {
      let inner: Document | null = null;
      try {
        inner = frame.contentDocument;
      } catch {
        inner = null; // a frame from another site
      }
      if (!inner?.body || !shows(frame)) continue;
      const r = frame.getBoundingClientRect();
      const s = windowOf(frame).getComputedStyle(frame);
      const left = offset[0] + r.left + frame.clientLeft + parseFloat(s.paddingLeft);
      const top = offset[1] + r.top + frame.clientTop + parseFloat(s.paddingTop);
      const width = frame.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      const height = frame.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom);
      const around = clipOf(frame);
      if (!around) continue;
      const box = within(new DOMRect(left, top, width, height), clip);
      const seen = box && within(new DOMRect(box[0], box[1], box[2], box[3]), shift(around, offset));
      if (!seen) continue;
      visit(inner, [left, top], new DOMRect(seen[0], seen[1], seen[2], seen[3]));
    }
  };
  visit(document, [0, 0], new DOMRect(0, 0, innerWidth, innerHeight));
  return out;
}

function shift(r: DOMRect, by: [number, number]): DOMRect {
  return new DOMRect(r.left + by[0], r.top + by[1], r.width, r.height);
}

/** Every named control, in the program's page and its frames. */
function named(all = surfaces()): { el: HTMLElement; at: Surface }[] {
  return all.flatMap((at) => Array.from(at.doc.querySelectorAll<HTMLElement>("[data-demo-id]")).map((el) => ({ el, at })));
}

/** Where an element's page sits on the program's page. */
function surfaceOf(el: Element, all = surfaces()): Surface {
  // The program's own page is always first, so all[0] is there.
  return all.find((s) => s.doc === el.ownerDocument) ?? all[0]!;
}

export function controlLabel(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
    if (text) return text;
  }
  const label = (el as HTMLInputElement).labels?.[0];
  if (label) {
    // The label’s own words, without the words of a control inside it (a list’s choices, say).
    const copy = label.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
    const text = copy.textContent?.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  const text = (el as HTMLElement).innerText?.trim() || el.textContent?.trim();
  if (text) return text.replace(/\s+/g, " ").slice(0, 80);
  return el.getAttribute("title") ?? el.getAttribute("placeholder") ?? "";
}

function controlRole(el: Element): string {
  const role = el.getAttribute("role");
  if (role) return role;
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const type = (el as HTMLInputElement).type;
    // A radio button and a slider say what they are (hook version 6), so a script clicks them rather than typing into them.
    return type === "checkbox" ? "checkbox" : type === "radio" ? "radio" : type === "range" ? "slider" : "textbox";
  }
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "a") return "link";
  return tag === "button" ? "button" : tag;
}

/** A named control, in the program's page or in one of its frames (the page first). */
function find(id: string): HTMLElement {
  for (const { doc } of surfaces()) {
    const el = doc.querySelector<HTMLElement>(`[data-demo-id="${CSS.escape(id)}"]`);
    if (el) return el;
  }
  throw new Error(`There is no control called "${id}" on screen.`);
}

function info(el: HTMLElement, at = surfaceOf(el)): ControlInfo {
  const own = el.getBoundingClientRect();
  // A hidden tick box or choice is where its label is drawn.
  const label = isTickable(el) ? (el.labels?.[0] ?? el.closest("label")) : null;
  const lr = label?.getBoundingClientRect();
  const [left, top, width, height] = shownRect([own.left, own.top, own.width, own.height], lr ? [lr.left, lr.top, lr.width, lr.height] : null);
  const r = { left, top, width, height };
  const style = windowOf(el).getComputedStyle(el);
  const visible = r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  return {
    id: el.dataset.demoId!,
    label: controlLabel(el),
    role: controlRole(el),
    rect: [r.left + at.offset[0], r.top + at.offset[1], r.width, r.height],
    visible,
    enabled: !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true",
    ...boxFacts(el),
    ...(isTickable(el) ? { checked: el.checked } : TICKABLE_ROLES.has(el.getAttribute("role") ?? "") && el.hasAttribute("aria-checked") ? { checked: el.getAttribute("aria-checked") === "true" } : {}),
    focused: focused() === el,
  };
}

/** Some words inside a control's text, as a range of the page (for clicking on words). A text box's or list's words are
 * not page text, so only text on the page and in editable areas can be clicked on this way. */
function wordsRange(el: HTMLElement, words: string, caret?: "before" | "after"): Range {
  if (isInput(el) || isTextArea(el) || isSelect(el)) throw new Error(`Clicking on words works on a page's text and in editable areas, not in the box "${el.dataset.demoId}".`);
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const at = findWords(nodes.map((n) => n.data).join(""), words);
  if (!at) throw new Error(`The words "${words}" are not in the control "${el.dataset.demoId}".`);
  const range = doc.createRange();
  let pos = 0;
  let started = false;
  for (const n of nodes) {
    const end = pos + n.data.length;
    if (!started && at[0] < end) {
      range.setStart(n, at[0] - pos);
      started = true;
    }
    if (started && at[1] <= end) {
      range.setEnd(n, at[1] - pos);
      break;
    }
    pos = end;
  }
  // The cursor alone, just before or after the words.
  if (caret) range.collapse(caret === "before");
  return range;
}

/** Where some words are on the program's page: the first line they are on. */
function wordsRect(range: Range, at: Surface): [number, number, number, number] {
  const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
  return [r.left + at.offset[0], r.top + at.offset[1], r.width, r.height];
}

/** For a box: the words in it now, and whether it takes several lines. A password box's words are never reported. */
function boxFacts(el: HTMLElement): { value?: string; multiline?: boolean } {
  if (isSelect(el)) return { value: el.selectedOptions[0]?.text ?? "", multiline: false };
  if (isTextArea(el)) return { value: el.value, multiline: true };
  if (isInput(el)) {
    if (["checkbox", "radio", "range", "color", "file", "hidden", "button", "submit", "reset"].includes(el.type)) return {};
    return el.type === "password" ? { multiline: false } : { value: el.value, multiline: false };
  }
  if (el.isContentEditable) return { value: el.innerText, multiline: true };
  return {};
}

/** The control that has the keyboard focus, as the hook keeps it. When the program's window is not the active one, the page
 * does not record focus given to a control (by the hook or by the program itself), so in demo mode the hook keeps it:
 * every call to focus() and blur() is noted (see watchFocus), and nothing else counts. That way a take looks the same
 * whether or not its window is in front. */
let lastFocus: HTMLElement | null = null;

/** The element kinds whose focus() and blur() are already watched, one per page or frame (a frame that loads a new page
 * gets new ones). */
const watched = new WeakSet<object>();

/** In demo mode, note every focus() and blur() call a page makes. */
function watchFocus(win: PageWindow) {
  const proto = win.HTMLElement.prototype;
  if (watched.has(proto)) return;
  watched.add(proto);
  const realFocus = proto.focus;
  const realBlur = proto.blur;
  proto.focus = function (this: HTMLElement, options?: FocusOptions) {
    const before = lastFocus;
    const delivered = heard(this, "focus", () => realFocus.call(this, options));
    lastFocus = this;
    // A window that is not the active one gets no focus events: send them, so the program knows what has the focus, as it
    // would in the active window (Prism Transcribe's editor learns which turn has the cursor from them).
    if (!delivered && before !== this && canTakeFocus(this)) moveFocusEvents(before, this);
    return undefined;
  };
  proto.blur = function (this: HTMLElement) {
    const had = lastFocus === this;
    if (had) lastFocus = null;
    const delivered = heard(this, "blur", () => realBlur.call(this));
    if (!delivered && had) moveFocusEvents(this, null);
    return undefined;
  };
}

/** Whether calling `act` made the browser send `type` to the element. */
function heard(el: HTMLElement, type: "focus" | "blur", act: () => void): boolean {
  let got = false;
  const mark = () => (got = true);
  el.addEventListener(type, mark);
  try {
    act();
  } finally {
    el.removeEventListener(type, mark);
  }
  return got;
}

/** Whether focus() would give an element the focus in an active window. */
function canTakeFocus(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled || !el.isConnected) return false;
  return el.tabIndex >= 0 || el.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName) || (el.tagName === "A" && el.hasAttribute("href"));
}

/** The events a browser sends when the focus moves from one element to another: blur and focusout on the one that had it,
 * focus and focusin on the one that gets it. */
function moveFocusEvents(from: HTMLElement | null, to: HTMLElement | null) {
  if (from?.isConnected) {
    const view = windowOf(from);
    from.dispatchEvent(new view.FocusEvent("blur", { relatedTarget: to }));
    from.dispatchEvent(new view.FocusEvent("focusout", { bubbles: true, relatedTarget: to }));
  }
  if (to) {
    const view = windowOf(to);
    to.dispatchEvent(new view.FocusEvent("focus", { relatedTarget: from }));
    to.dispatchEvent(new view.FocusEvent("focusin", { bubbles: true, relatedTarget: from }));
  }
}

/** Put a page or frame into demo mode once: the steady look, focus watched, its style rules rewritten. A frame that opens
 * later (a tools pane, say) is put in demo mode the first time the hook is asked anything after it appears. */
function steady(doc: Document) {
  if (doc.documentElement.dataset.demoMode === "on") return;
  const style = doc.createElement("style");
  style.dataset.demoHook = "steady";
  style.textContent = STEADY_CSS;
  (doc.head ?? doc.documentElement).append(style);
  doc.documentElement.dataset.demoMode = "on";
  watchFocus((doc.defaultView ?? window) as PageWindow);
  steadySheets(doc);
}

/** Give a control the keyboard focus, and remember it. */
function focusOn(el: HTMLElement, byKey = false) {
  if (lastFocus && lastFocus !== el) commitBox(lastFocus);
  el.focus({ preventScroll: true });
  lastFocus = el;
  focusByKey = byKey;
}

/** What has the keyboard focus now, as the hook keeps it (a control that has left the page has lost it). */
function focused(): HTMLElement | null {
  return lastFocus && lastFocus.isConnected ? lastFocus : null;
}

/** Whether the last focus came from a key (Tab), which shows a focus ring on any control, or from a click, which shows one
 * only on fields you type in. */
let focusByKey = false;
const STATE_MARKS = ["data-demo-focus", "data-demo-focus-visible", "data-demo-focus-within"];

/** Rewrite the page's style rules so focus and hover follow the hook's markers (see steadySelector). Rules added since the
 * last time are rewritten too; rules from other sites cannot be read and are left as they are. */
function steadySheets(doc: Document) {
  const view = (doc.defaultView ?? window) as PageWindow;
  const rewrite = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof view.CSSStyleRule) {
        const next = steadySelector(rule.selectorText);
        if (next !== rule.selectorText) rule.selectorText = next;
      }
      if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) rewrite((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of [...Array.from(doc.styleSheets), ...(doc.adoptedStyleSheets ?? [])]) {
    try {
      rewrite(sheet.cssRules);
    } catch {
      // A sheet from another site cannot be read.
    }
  }
}

/** Put the focus markers on the control that has the focus and on what holds it. */
function markFocus(all = surfaces()) {
  for (const { doc } of all) {
    for (const name of STATE_MARKS) doc.querySelectorAll(`[${name}]`).forEach((el) => el.removeAttribute(name));
  }
  const el = focused();
  if (!el) return;
  el.setAttribute("data-demo-focus", "");
  if (focusByKey || takesText(el)) el.setAttribute("data-demo-focus-visible", "");
  // What holds the focus, up through the frame it is in and what holds that frame.
  for (let p: Element | null = el; p; p = p.parentElement ?? (p.ownerDocument.defaultView?.frameElement ?? null)) {
    p.setAttribute("data-demo-focus-within", "");
  }
}

/** Whether typing can go into this control. */
function takesText(el: HTMLElement): boolean {
  return isTextArea(el) || isSelect(el) || el.isContentEditable ||
    (isInput(el) && !["button", "checkbox", "radio", "submit", "reset", "file", "image", "range", "color"].includes(el.type));
}

/** Resolves once none of the documents has changed for `still` milliseconds, or after `most` milliseconds whatever happens. */
function quiet(docs: Document[], still = 150, most = 1500): Promise<void> {
  return new Promise((done) => {
    const watchers: MutationObserver[] = [];
    let timer = setTimeout(finish, still);
    const cap = setTimeout(finish, most);
    function finish() {
      clearTimeout(timer);
      clearTimeout(cap);
      for (const w of watchers) w.disconnect();
      done();
    }
    for (const doc of docs) {
      const view = doc.defaultView;
      if (!view || !doc.body) continue;
      const w = new view.MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(finish, still);
      });
      w.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "style", "open", "data-index"] });
      watchers.push(w);
    }
  });
}

const frames = (n: number) => new Promise<void>((done) => {
  const tick = (k: number) => (k <= 0 ? done() : requestAnimationFrame(() => tick(k - 1)));
  tick(n);
});

/** The boxes typed into since they got the focus. As in a browser, such a box tells the page it changed (a change event) when the
 * focus leaves it, or when Enter is pressed in a one-line box. */
const typedIn = new WeakSet<HTMLElement>();
function commitBox(el: HTMLElement) {
  if (!typedIn.has(el)) return;
  typedIn.delete(el);
  el.dispatchEvent(new (windowOf(el).Event)("change", { bubbles: true }));
}

/** Number boxes and the like have no text selection: the boxes whose words Ctrl+A chose, so the next typing replaces them. */
const allChosen = new WeakSet<HTMLInputElement>();
/** Whether a box has a text selection (a number box does not, and refuses setRangeText). */
function hasSelection(el: HTMLInputElement): boolean {
  try {
    return el.selectionStart !== null;
  } catch {
    return false;
  }
}

/**
 * What was typed into a box with no text selection, and what the box held straight after: a number box empties itself while its
 * text is not yet a number, so "0.5" read back after "0." became "" and then "5" (OpenStage Assess, 2026-11-26: a give or take of
 * 0.5 was stored as 5). It is kept with the box and not inside one call, because the player sends one character per command (the
 * first fix kept it inside the call and changed nothing). While the box still holds what it held after the last character, the
 * typing goes on from what was typed; once anything else has changed the box, from what it holds.
 */
const typedSoFar = new WeakMap<HTMLInputElement, { typed: string; held: string }>();

/** Put text into a text field or editable area as if typed: one character at a time, with the events a keyboard sends. */
function typeInto(el: HTMLElement, text: string) {
  const view = windowOf(el);
  for (const ch of text) {
    const init = { key: ch, bubbles: true, cancelable: true };
    const go = el.dispatchEvent(new view.KeyboardEvent("keydown", init));
    if (go) {
      if (isInput(el) || isTextArea(el)) typedIn.add(el);
      if (isInput(el) && !hasSelection(el)) {
        // A box with no text selection (a number box): the character goes at the end, or replaces all after Ctrl+A.
        const last = typedSoFar.get(el);
        const before = allChosen.has(el) ? "" : last && el.value === last.held ? last.typed : el.value;
        const typed = before + ch;
        el.value = typed;
        typedSoFar.set(el, { typed, held: el.value });
        allChosen.delete(el);
        el.dispatchEvent(new view.InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
      } else if (isInput(el) || isTextArea(el)) {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        el.setRangeText(ch, start, end, "end");
        el.dispatchEvent(new view.InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
      } else if (el.isContentEditable) {
        el.ownerDocument.execCommand("insertText", false, ch);
      }
    }
    el.dispatchEvent(new view.KeyboardEvent("keyup", init));
  }
}

/** The controls Tab moves between, in the page or frame the focus is in. */
function focusables(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1']), [contenteditable='true']")]
    .filter((el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0);
}

function pressKey(target: HTMLElement, key: string, modifiers: string[]) {
  const view = windowOf(target);
  const name = key === "Space" ? " " : key.length === 1 ? key.toLowerCase() : key;
  const init: KeyboardEventInit = {
    key: name, bubbles: true, cancelable: true,
    ctrlKey: modifiers.includes("Ctrl"), altKey: modifiers.includes("Alt"), shiftKey: modifiers.includes("Shift"),
  };
  const go = target.dispatchEvent(new view.KeyboardEvent("keydown", init));
  if (go) {
    // What the browser would do itself for these keys when nothing handled them.
    if (key === "Tab") {
      commitBox(target);
      const list = focusables(target.ownerDocument);
      const i = list.indexOf(target.ownerDocument.activeElement as HTMLElement);
      const next = list[(i + (init.shiftKey ? -1 : 1) + list.length) % list.length];
      next?.focus();
    } else if ((key === "Enter" || key === "Space") && (isButton(target) || target.getAttribute("role") === "button")) {
      target.click();
    } else if (key === "Space" && (isTickable(target) || TICKABLE_ROLES.has(target.getAttribute("role") ?? ""))) {
      // Space ticks or unticks a tick box and chooses a radio button, as it does for a person.
      target.click();
    } else if (key === "Enter" && isInput(target)) {
      commitBox(target);
      // Enter in a form's box sends the form, as a browser does when the form has a button that sends it or only one box.
      const form = target.form;
      if (form && !isTickable(target) && (form.querySelector("button:not([type]), button[type=submit], input[type=submit]") || form.querySelectorAll("input").length === 1)) {
        form.requestSubmit();
      }
    } else if (key === "Backspace" && isInput(target) && !hasSelection(target)) {
      typedIn.add(target);
      target.value = allChosen.has(target) ? "" : target.value.slice(0, -1);
      allChosen.delete(target);
      target.dispatchEvent(new view.InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    } else if (key === "Backspace" && (isInput(target) || isTextArea(target))) {
      typedIn.add(target);
      const s = target.selectionStart ?? 0;
      const e = target.selectionEnd ?? 0;
      if (s !== e) target.setRangeText("", s, e, "end");
      else if (s > 0) target.setRangeText("", s - 1, s, "end");
      target.dispatchEvent(new view.InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    } else if ((key === "Backspace" || key === "Delete") && target.isContentEditable) {
      // In an editable area: the selected words, or the character before (Backspace) or after (Delete) the cursor.
      target.ownerDocument.execCommand(key === "Backspace" ? "delete" : "forwardDelete");
    } else if (target.isContentEditable && caretMove(key, modifiers)) {
      // The arrow keys, Home and End move the cursor in an editable area (a read-only one too), and with Shift select, as a person's do.
      const move = caretMove(key, modifiers)!;
      const selection = view.getSelection() as (Selection & { modify?: (alter: string, direction: string, granularity: string) => void }) | null;
      selection?.modify?.(move.alter, move.direction, move.granularity);
    } else if (key === "Enter" && isTextArea(target)) {
      typeInto(target, "\n");
    } else if (key === "A" && init.ctrlKey && !init.altKey && (isInput(target) || isTextArea(target))) {
      // Select all of the box's words, so the next typing replaces them.
      target.select();
      if (isInput(target) && !hasSelection(target)) allChosen.add(target);
    } else if (key === "A" && init.ctrlKey && !init.altKey && target.isContentEditable) {
      // The same in an editable area (a box that shows bold and italic as it is typed in): all of its words, from its outermost
      // editable element.
      let root: HTMLElement = target;
      while (root.parentElement?.isContentEditable) root = root.parentElement;
      const range = root.ownerDocument.createRange();
      range.selectNodeContents(root);
      const selection = view.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }
  target.dispatchEvent(new view.KeyboardEvent("keyup", init));
}

/** Take every hover look off, in the page and its frames. */
function clearHover(all = surfaces()) {
  for (const { doc } of all) doc.querySelectorAll("[data-demo-hover]").forEach((el) => el.removeAttribute("data-demo-hover"));
}

async function perform(command: Command, options: DemoHookOptions): Promise<unknown> {
  // A frame that has appeared since the last command is put in demo mode before anything else.
  const all = surfaces();
  for (const { doc } of all) steady(doc);
  switch (command.cmd) {
    case "hello": {
      const hello: Hello = {
        program: options.program, hookVersion: HOOK_VERSION, viewport: [innerWidth, innerHeight],
        devicePixelRatio, controls: named(all).length,
      };
      return hello;
    }
    case "list":
      return { viewport: [innerWidth, innerHeight], controls: named(all).map(({ el, at }) => info(el, at)) };
    case "position": {
      const el = find(command.id);
      const control = info(el);
      const range = command.words ? wordsRange(el, command.words, command.caret) : null;
      if (range) control.rect = wordsRect(range, surfaceOf(el));
      control.seen = seenOf(range ? (range.startContainer.parentElement ?? el) : el, control.rect);
      return { viewport: [innerWidth, innerHeight], control };
    }
    case "hover": {
      clearHover(all);
      if (command.id) find(command.id).setAttribute("data-demo-hover", "");
      return null;
    }
    case "click": {
      const el = find(command.id);
      if (!info(el).enabled) throw new Error(`The control "${command.id}" is switched off and cannot be clicked.`);
      clearHover(all);
      // On words: the events carry the words' place, and the words are selected as the button goes down, as in a browser.
      const range = command.words ? wordsRange(el, command.words, command.caret) : null;
      focusOn(el);
      const view = windowOf(el);
      // The events carry what a mouse click carries: the point it lands on (the words, or the middle of the control) and the
      // mouse as the kind of pointer. A program may count a press only when the button comes up over the control, as React
      // Aria's tick boxes do (version 6, 2026-11-20: Prism Transcribe's I understand box never ticked without them).
      const r = range ? (range.getClientRects()[0] ?? range.getBoundingClientRect()) : el.getBoundingClientRect();
      const init: PointerEventInit = {
        bubbles: true, cancelable: true, composed: true, button: 0, detail: 1, view,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: "mouse", isPrimary: true,
      };
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        const down = type.endsWith("down");
        const event = { ...init, buttons: down ? 1 : 0, ...(type.startsWith("pointer") ? { pressure: down ? 0.5 : 0 } : {}) };
        el.dispatchEvent(new (type.startsWith("pointer") ? view.PointerEvent : view.MouseEvent)(type, event));
        if (type === "mousedown" && range) {
          const selection = view.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      }
      if (range) el.dispatchEvent(new view.MouseEvent("click", init));
      else el.click();
      return null;
    }
    case "focus":
      focusOn(find(command.id));
      return null;
    case "type": {
      const el = command.id ? find(command.id) : focused();
      if (!el) throw new Error("Nothing has the keyboard focus to type into. Give the step a target.");
      if (!takesText(el)) throw new Error(`The control with the keyboard focus (${el.dataset.demoId ?? el.tagName.toLowerCase()}) cannot take typing. Give the step a target.`);
      if (command.id || el.ownerDocument.activeElement !== el) focusOn(el);
      if (isSelect(el)) {
        // A drop-down list: typing its option's words chooses it, as typing does on a focused list.
        const wanted = command.text.trim().toLowerCase();
        const option = [...el.options].find((o) => o.text.trim().toLowerCase() === wanted) ?? [...el.options].find((o) => o.text.trim().toLowerCase().startsWith(wanted));
        if (!option) throw new Error(`The list "${el.dataset.demoId}" has no choice called "${command.text}".`);
        el.value = option.value;
        el.dispatchEvent(new (windowOf(el).Event)("input", { bubbles: true }));
        el.dispatchEvent(new (windowOf(el).Event)("change", { bubbles: true }));
        return null;
      }
      typeInto(el, command.text);
      return null;
    }
    case "key": {
      const el = command.id ? find(command.id) : (focused() ?? document.body);
      if (command.id) focusOn(el);
      pressKey(el, command.key, command.modifiers);
      if (command.key === "Tab") focusByKey = true;
      return null;
    }
    case "scroll": {
      const el = command.id ? find(command.id) : (document.scrollingElement as HTMLElement);
      el.scrollBy(command.axis === "y" ? { top: command.amount } : { left: command.amount });
      return null;
    }
    case "reveal": {
      const el = find(command.id);
      if (command.amount === undefined) return { amount: revealAmount(el) };
      scrollerOf(el).scrollBy({ top: command.amount, behavior: "instant" });
      return null;
    }
    case "loadDemo":
      await options.loadDemo(command.name);
      return null;
    case "reset":
      await options.reset();
      return null;
    case "settle":
      for (const { doc } of all) steadySheets(doc);
      markFocus(all);
      for (const { doc } of all) {
        await doc.fonts.ready;
        await Promise.all(doc.getAnimations().map((a) => a.finished.catch(() => undefined)));
      }
      // A program may draw a moment after a click, on a timer of its own (OpenStage Guide draws a guide's page a little after it opens):
      // wait until the page and its frames have stopped changing for a short while, so the picture and the next step see the result.
      await quiet(all.map((s) => s.doc));
      if (options.busy?.()) {
        // Work the program does a moment later, on a timer, changes nothing yet, so quiet() cannot see it coming: wait for it,
        // then for the page to show its result.
        const end = Date.now() + BUSY_MOST_MS;
        while (options.busy() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
        await quiet(all.map((s) => s.doc));
      }
      await frames(2);
      return null;
    case "text":
      return { viewport: [innerWidth, innerHeight], items: all.flatMap(textOnScreen) };
  }
}

/** Elements whose text never shows as it is (or shows only when opened, such as a drop-down list's choices). */
const NO_TEXT = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SELECT", "OPTION", "OPTGROUP", "DATALIST", "TEXTAREA"]);

/** The part of its own page an element can show through: that page's window (or frame), cut down by every scrolling or
 * clipping box around it. In that page's own coordinates. */
function clipOf(el: Element): DOMRect | null {
  const view = windowOf(el);
  let [left, top, right, bottom] = [0, 0, view.innerWidth, view.innerHeight];
  const doc = el.ownerDocument;
  for (let p = el.parentElement; p; p = p.parentElement) {
    // The overflow of <html> and <body> belongs to the window itself, which is already the start (CSS carries it to the viewport).
    // A page that sets overflow: hidden on a body with nothing in its flow (PrismQDA's, whose content is in a fixed #root) would
    // otherwise clip every word away.
    if (p === doc.body || p === doc.documentElement) continue;
    const s = view.getComputedStyle(p);
    if (s.overflowX !== "visible" || s.overflowY !== "visible") {
      const r = p.getBoundingClientRect();
      left = Math.max(left, r.left);
      top = Math.max(top, r.top);
      right = Math.min(right, r.right);
      bottom = Math.min(bottom, r.bottom);
    }
  }
  return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : null;
}

function shows(el: Element): boolean {
  const view = windowOf(el);
  for (let p: Element | null = el; p; p = p.parentElement) {
    const s = view.getComputedStyle(p);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    // What a closed <details> holds keeps its place but is not drawn; only its summary shows.
    if (p instanceof view.HTMLDetailsElement && !p.open && p !== el && !p.querySelector(":scope > summary")?.contains(el)) return false;
  }
  return true;
}

/** The visible part of a rectangle, or null if none of it shows. */
function within(r: DOMRect, clip: DOMRect): [number, number, number, number] | null {
  const left = Math.max(r.left, clip.left), top = Math.max(r.top, clip.top);
  const right = Math.min(r.right, clip.right), bottom = Math.min(r.bottom, clip.bottom);
  return right - left >= 1 && bottom - top >= 1 ? [left, top, right - left, bottom - top] : null;
}

/** The part of a control's place (on the program's page) that the window and the scrolling boxes around it let show. Null: none of it. */
function seenOf(el: Element, rect: [number, number, number, number]): [number, number, number, number] | null {
  const at = surfaceOf(el);
  // A hidden tick box or choice is drawn as its label.
  const drawn = isTickable(el) ? (el.labels?.[0] ?? el.closest("label") ?? el) : el;
  const own = shows(drawn) ? clipOf(drawn) : null;
  const clip = own && within(shift(own, at.offset), at.clip);
  // A cursor among the words has no width of its own.
  return clip && within(new DOMRect(rect[0], rect[1], Math.max(1, rect[2]), Math.max(1, rect[3])), new DOMRect(...clip));
}

/** The box that scrolls a control up and down: the nearest one around it that can, else the page. */
function scrollerOf(el: HTMLElement): HTMLElement {
  const view = windowOf(el);
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = view.getComputedStyle(p).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (el.ownerDocument.scrollingElement ?? el.ownerDocument.documentElement) as HTMLElement;
}

/** Room left at the edges when a control is scrolled into view, in CSS pixels. */
const REVEAL_MARGIN = 24;

/**
 * How far a control's scrolling box must move for the whole control to show, in CSS pixels (0 when it shows, or when it is not
 * drawn). A control that does not show is brought to the middle of the box, or to its top when it is too tall for that, within what
 * the box can scroll. Showing means inside the box and the window and not under something else (a bar fixed at the top of the page).
 */
function revealAmount(el: HTMLElement): number {
  const drawn = isTickable(el) ? (el.labels?.[0] ?? el.closest("label") ?? el) : el;
  if (!shows(drawn)) return 0;
  const view = windowOf(el);
  const scroller = scrollerOf(el);
  const page = scroller === el.ownerDocument.scrollingElement || scroller === el.ownerDocument.documentElement;
  const box = page ? { top: 0, bottom: view.innerHeight } : scroller.getBoundingClientRect();
  const top = Math.max(0, box.top);
  const bottom = Math.min(view.innerHeight, box.bottom);
  const r = drawn.getBoundingClientRect();
  if (r.height <= 0) return 0;
  const inside = r.top >= top && r.bottom <= bottom;
  const hit = (y: number) => {
    const at = el.ownerDocument.elementFromPoint(r.left + Math.min(r.width / 2, 20), y);
    return !at || drawn.contains(at) || at.contains(drawn);
  };
  // Covered counts only near the top, where a bar fixed over the page hides what scrolls under it; lower down it is a dialog or a
  // message over the page, which scrolling would not uncover.
  if (inside && ((hit(r.top + 2) && hit(r.bottom - 2)) || r.top > top + (bottom - top) / 4)) return 0;
  const room = bottom - top;
  const wanted = r.height <= room - 2 * REVEAL_MARGIN ? r.top + r.height / 2 - (top + room / 2) : r.top - top - REVEAL_MARGIN;
  const most = scroller.scrollHeight - scroller.clientHeight;
  return Math.round(Math.max(-scroller.scrollTop, Math.min(most - scroller.scrollTop, wanted)));
}

/** A Windows path in some words: to its file's ending when it has one (a file's name may have spaces), else to the next space. */
const A_PATH = /[A-Za-z]:[\\/](?:[^<>:"|?*\n]*\.[A-Za-z0-9]{2,5}(?![A-Za-z0-9])|[^\s<>:"|?*]*)/g;

/** Every piece of text the viewer can see in one page or frame, with where it is on the program's page: the words, what is
 * typed in fields (or their placeholder when empty), and the choice showing in each drop-down list. Used by the frame
 * scan, never by the take. */
function textOnScreen({ doc, offset, clip: frameClip }: Surface): TextOnScreen[] {
  const out: TextOnScreen[] = [];
  const clips = new Map<Element, DOMRect | null>();
  // An element's clip on the program's page: its own page's clip, moved to where the frame is and cut to what the frame shows.
  const clip = (el: Element) => {
    if (!clips.has(el)) {
      const own = shows(el) ? clipOf(el) : null;
      const seen = own && within(shift(own, offset), frameClip);
      clips.set(el, seen ? new DOMRect(seen[0] - offset[0], seen[1] - offset[1], seen[2], seen[3]) : null);
    }
    return clips.get(el)!;
  };
  const place = (r: [number, number, number, number]): [number, number, number, number] => [r[0] + offset[0], r[1] + offset[1], r[2], r[3]];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      for (let p = n.parentElement; p; p = p.parentElement) if (NO_TEXT.has(p.tagName)) return NodeFilter.FILTER_REJECT;
      return n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement!;
    const c = clip(el);
    if (!c) continue;
    const range = doc.createRange();
    range.selectNodeContents(n);
    // One piece per line the text wraps onto, so each has its own place.
    const lines = [...range.getClientRects()].map((r) => within(r, c)).filter((r): r is [number, number, number, number] => r !== null).map(place);
    if (!lines.length) continue;
    // A folder path is a piece of its own, one for each line it is on, so it can be blurred where it is and the words around it stay.
    let words = n.textContent!;
    for (const m of [...words.matchAll(A_PATH)]) {
      const path = doc.createRange();
      path.setStart(n, m.index);
      path.setEnd(n, m.index + m[0].length);
      for (const r of path.getClientRects()) {
        const seen = within(r, c);
        if (seen) out.push({ text: m[0].replace(/\s+/g, " ").trim(), rect: place(seen) });
      }
      words = words.replace(m[0], " ");
    }
    const text = words.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const left = Math.min(...lines.map((r) => r[0])), top = Math.min(...lines.map((r) => r[1]));
    const right = Math.max(...lines.map((r) => r[0] + r[2])), bottom = Math.max(...lines.map((r) => r[1] + r[3]));
    out.push({ text, rect: [left, top, right - left, bottom - top] });
  }
  for (const el of doc.querySelectorAll<HTMLElement>("input, textarea, select")) {
    let text = "";
    if (isSelect(el)) text = el.selectedOptions[0]?.text ?? "";
    else if (isInput(el) && ["checkbox", "radio", "range", "color", "file", "hidden"].includes(el.type)) continue;
    else {
      const field = el as HTMLInputElement | HTMLTextAreaElement;
      text = field.type === "password" ? "" : field.value || field.placeholder;
    }
    if (!text.trim()) continue;
    const c = clip(el);
    const r = c && within(el.getBoundingClientRect(), c);
    if (r) out.push({ text: text.replace(/\s+/g, " ").trim(), rect: place(r) });
  }
  return out;
}

/** Start the hook if the program was launched in demo mode. Returns null (and does nothing) otherwise. */
export function startDemoHook(options: DemoHookOptions): DemoHook | null {
  const settings = options.settings ?? readSettings(globalThis as unknown as Record<string, unknown>, location.search);
  if (!settings) return null;
  // The program's page now; each frame from the program as it is first seen (see perform).
  steady(document);

  let stopped = false;
  const url = (path: string) => `${settings.endpoint}/hook/${path}?token=${encodeURIComponent(settings.token)}`;
  const loop = async () => {
    while (!stopped) {
      let envelope: Envelope | null = null;
      try {
        const res = await fetch(url("next"), { cache: "no-store" });
        if (res.status === 204) continue;
        if (res.status === 410) break; // the take is over
        if (!res.ok) throw new Error(`The player answered ${res.status}.`);
        envelope = (await res.json()) as Envelope;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      let reply: Reply;
      try {
        reply = { seq: envelope.seq, ok: true, result: await perform(envelope, options) };
      } catch (e) {
        reply = { seq: envelope.seq, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      try {
        // Plain text, so the browser sends it without asking the player first.
        await fetch(url("reply"), { method: "POST", body: JSON.stringify(reply), headers: { "Content-Type": "text/plain" } });
      } catch {
        // The player will time out and say so.
      }
    }
  };
  void loop();
  return {
    stop() {
      stopped = true;
      for (const { doc } of surfaces()) {
        doc.querySelectorAll('style[data-demo-hook="steady"]').forEach((s) => s.remove());
        delete doc.documentElement.dataset.demoMode;
      }
    },
  };
}
