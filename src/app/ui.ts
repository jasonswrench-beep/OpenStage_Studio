// Small building blocks for the window's pages. Every control has a visible label; every state is said in words.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("aria-") || k === "role" || k.startsWith("data-")) e.setAttribute(k, String(v));
    else (e as unknown as Record<string, unknown>)[k] = v;
  }
  e.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  return e;
}

let ids = 0;
const nextId = (base: string) => `${base}-${++ids}`;

/** A labelled text field, with an optional hint read out with it. */
export function textField(label: string, o: { value?: string; hint?: string; type?: string; autocomplete?: string; wide?: boolean } = {}) {
  const id = nextId("f");
  const input = el("input", { id, type: o.type ?? "text", value: o.value ?? "", autocomplete: o.autocomplete ?? "off", spellcheck: false });
  if (o.wide) input.className = "wide";
  // A hint given as "" is a place for one, filled in later.
  const hint = o.hint !== undefined ? el("span", { id: `${id}-hint`, className: "muted" }, o.hint) : null;
  if (hint) input.setAttribute("aria-describedby", hint.id);
  const wrap = el("div", { className: "field" }, el("label", { htmlFor: id }, label), input, hint);
  return { wrap, input };
}

/** A labelled drop-down list. */
export function selectField(label: string, options: { value: string; text: string }[], value?: string) {
  const id = nextId("s");
  const select = el("select", { id }, ...options.map((o) => el("option", { value: o.value, selected: o.value === value }, o.text)));
  return { wrap: el("div", { className: "field" }, el("label", { htmlFor: id }, label), select), select };
}

/** A group of choices (radio buttons) with a legend. */
export function choiceGroup(legend: string, options: { value: string; text: string; hint?: string }[], value?: string) {
  const name = nextId("g");
  const inputs: HTMLInputElement[] = [];
  const set = el("fieldset", { className: "choices-v" }, el("legend", {}, legend));
  for (const [i, o] of options.entries()) {
    const id = `${name}-${i + 1}`;
    const input = el("input", { type: "radio", name, id, value: o.value, checked: o.value === value });
    inputs.push(input);
    const hint = o.hint ? el("span", { className: "muted" }, ` ${o.hint}`) : null;
    set.append(el("div", { className: "choice" }, input, el("label", { htmlFor: id }, o.text, hint)));
  }
  return { wrap: set, inputs, value: () => inputs.find((i) => i.checked)?.value ?? "" };
}

export function checkbox(label: string, checked = false) {
  const id = nextId("c");
  const input = el("input", { type: "checkbox", id, checked });
  return { wrap: el("div", { className: "choice" }, input, el("label", { htmlFor: id }, label)), input };
}

export const button = (text: string, onClick: () => void | Promise<void>, o: { quiet?: boolean; describedBy?: string } = {}) => {
  const b = el("button", { type: "button", className: o.quiet ? "quiet" : "" }, text);
  if (o.describedBy) b.setAttribute("aria-describedby", o.describedBy);
  b.addEventListener("click", () => void onClick());
  return b;
};

/** A page's heading, which takes the focus when the page opens. */
export const heading = (text: string) => el("h2", { tabIndex: -1, className: "page-h" }, text);

/** A line for the result of the last thing done on a page. Polite, so a screen reader reads it when it changes. */
export function resultLine() {
  const p = el("p", { className: "result", role: "status" });
  return {
    el: p,
    set(text: string, kind: "good" | "bad" | "plain" = "plain") {
      p.textContent = "";
      p.className = `result ${kind}`;
      // Said in words; the mark and colour only repeat what the words say.
      setTimeout(() => (p.textContent = kind === "good" ? `✓ ${text}` : kind === "bad" ? `✗ ${text}` : text), 40);
    },
  };
}

/** A block of report text a person can read line by line with the keyboard. */
export const reportBlock = (label: string, text: string) => el("pre", { className: "report", tabIndex: 0, "aria-label": label }, text);

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
