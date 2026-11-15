// Practice Planner: a small invented program that OpenStage Studio records for its own tests and examples.
// It is a lesson planner with a toolbar, a list, a form, a menu, a dialog and keyboard shortcuts, which covers the kinds
// of work the first version records: clicks, typing, menus, dialogs and scrolling. It includes the demo-mode hook.

import { startDemoHook } from "../demo-hook/hook.ts";
import { DEMO_PROJECTS, LENGTHS, SUBJECTS, type Lesson } from "./demos.ts";
import { programVersion, VERSION_2_CHANGES } from "./versions.ts";
import "./style.css";

let lessons: Lesson[] = [];
let selected = -1;
let projectLabel = "";
let dirty = false;
let filter = "";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

document.body.innerHTML = `
<div class="app">
  <header class="bar">
    <div class="brand"><span class="logo" aria-hidden="true"></span>Practice Planner</div>
    <nav class="tools" aria-label="Lesson tools">
      <button data-demo-id="toolbar.lesson.new" id="new">New lesson</button>
      <button data-demo-id="toolbar.lesson.duplicate" id="dup">Duplicate</button>
      <button data-demo-id="toolbar.lesson.delete" id="del">Delete</button>
      <div class="menu-wrap">
        <button data-demo-id="toolbar.insert" id="insert" aria-haspopup="menu" aria-expanded="false">Insert</button>
        <div class="menu" id="insert-menu" role="menu" hidden>
          <button role="menuitem" data-demo-id="menu.insert.objective" data-text="Objective: ">Learning objective</button>
          <button role="menuitem" data-demo-id="menu.insert.materials" data-text="Materials: ">Materials line</button>
          <button role="menuitem" data-demo-id="menu.insert.homework" data-text="Homework: ">Homework line</button>
        </div>
      </div>
      <button data-demo-id="toolbar.settings" id="settings">Lesson settings</button>
    </nav>
  </header>
  <aside class="side">
    <div class="project" id="project"></div>
    <label class="search">Search lessons<input data-demo-id="sidebar.search" id="search" type="text" autocomplete="off"></label>
    <ul class="list" id="list" data-demo-id="sidebar.list" aria-label="Lessons"></ul>
  </aside>
  <main class="editor" id="editor">
    <p class="empty" id="empty">Choose a lesson on the left, or make a new one with New lesson.</p>
    <form id="form" hidden>
      <label>Lesson title<input data-demo-id="editor.title" id="title" type="text" autocomplete="off"></label>
      <div class="row">
        <label>Subject<select data-demo-id="editor.subject" id="subject">${SUBJECTS.map((s) => `<option>${s}</option>`).join("")}</select></label>
        <label>Length<select data-demo-id="editor.length" id="length">${LENGTHS.map((m) => `<option value="${m}">${m} minutes</option>`).join("")}</select></label>
      </div>
      <label>Notes<textarea data-demo-id="editor.notes" id="notes" rows="6"></textarea></label>
      <fieldset class="checklist"><legend>Things to bring</legend>
        <ul id="checklist"></ul>
        <button type="button" data-demo-id="editor.checklist.add" id="add-item">Add item</button>
      </fieldset>
      <div class="actions"><button type="submit" class="primary" data-demo-id="editor.save" id="save">Save lesson</button></div>
    </form>
  </main>
  <footer class="status" id="status" role="status" data-demo-id="statusbar">Ready</footer>
  <div class="scrim" id="scrim" hidden></div>
  <div class="dialog" id="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" hidden>
    <h2 id="dialog-title">Lesson settings</h2>
    <label class="check"><input type="checkbox" data-demo-id="dialog.settings.share" id="share">Share this lesson with the class page</label>
    <label class="check"><input type="checkbox" data-demo-id="dialog.settings.reminder" id="reminder">Remind me the day before</label>
    <div class="actions">
      <button data-demo-id="dialog.settings.cancel" id="cancel">Cancel</button>
      <button class="primary" data-demo-id="dialog.settings.ok" id="ok">OK</button>
    </div>
  </div>
</div>`;

function status(text: string) {
  $("#status").textContent = text;
}

function renderList() {
  const list = $<HTMLUListElement>("#list");
  list.innerHTML = "";
  lessons.forEach((l, i) => {
    if (filter && !l.title.toLowerCase().includes(filter.toLowerCase())) return;
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.demoId = `sidebar.lesson.${i + 1}`;
    b.className = i === selected ? "item selected" : "item";
    b.setAttribute("aria-current", i === selected ? "true" : "false");
    b.innerHTML = `<span class="t"></span><span class="m"></span>`;
    b.querySelector(".t")!.textContent = l.title || "Untitled lesson";
    b.querySelector(".m")!.textContent = `${l.subject} · ${l.minutes} min`;
    b.addEventListener("click", () => select(i));
    li.append(b);
    list.append(li);
  });
  $("#project").textContent = `${projectLabel} · ${lessons.length} lessons`;
}

function renderChecklist(l: Lesson) {
  const ul = $<HTMLUListElement>("#checklist");
  ul.innerHTML = "";
  l.checklist.forEach((item, k) => {
    const li = document.createElement("li");
    const input = document.createElement("input");
    input.type = "text";
    input.value = item;
    input.dataset.demoId = `editor.checklist.item.${k + 1}`;
    input.setAttribute("aria-label", `Item ${k + 1}`);
    input.addEventListener("input", () => {
      l.checklist[k] = input.value;
      changed();
    });
    li.append(input);
    ul.append(li);
  });
}

function select(i: number) {
  selected = i;
  const l = lessons[i];
  $("#empty").hidden = !!l;
  $("#form").hidden = !l;
  if (l) {
    $<HTMLInputElement>("#title").value = l.title;
    $<HTMLSelectElement>("#subject").value = l.subject;
    $<HTMLSelectElement>("#length").value = String(l.minutes);
    $<HTMLTextAreaElement>("#notes").value = l.notes;
    renderChecklist(l);
  }
  renderList();
}

function changed() {
  dirty = true;
  status("Changes not saved yet");
}

function save() {
  if (selected < 0) return;
  dirty = false;
  renderList();
  status(`Saved "${lessons[selected].title || "Untitled lesson"}"`);
}

function current(): Lesson | undefined {
  return lessons[selected];
}

$("#new").addEventListener("click", () => {
  lessons.push({ title: "", subject: SUBJECTS[2], minutes: 45, notes: "", checklist: [], shared: false });
  select(lessons.length - 1);
  changed();
  $<HTMLInputElement>("#title").focus();
});
$("#dup").addEventListener("click", () => {
  const l = current();
  if (!l) return;
  lessons.splice(selected + 1, 0, { ...l, title: `${l.title} (copy)`, checklist: [...l.checklist] });
  select(selected + 1);
  changed();
});
$("#del").addEventListener("click", () => {
  if (selected < 0) return;
  lessons.splice(selected, 1);
  select(Math.min(selected, lessons.length - 1));
  status("Lesson deleted");
});
$("#title").addEventListener("input", () => {
  const l = current();
  if (!l) return;
  l.title = $<HTMLInputElement>("#title").value;
  renderList();
  changed();
});
$("#subject").addEventListener("change", () => {
  const l = current();
  if (l) l.subject = $<HTMLSelectElement>("#subject").value;
  renderList();
  changed();
});
$("#length").addEventListener("change", () => {
  const l = current();
  if (l) l.minutes = Number($<HTMLSelectElement>("#length").value);
  renderList();
  changed();
});
$("#notes").addEventListener("input", () => {
  const l = current();
  if (l) l.notes = $<HTMLTextAreaElement>("#notes").value;
  changed();
});
$("#add-item").addEventListener("click", () => {
  const l = current();
  if (!l) return;
  l.checklist.push("");
  renderChecklist(l);
  changed();
  ($(`#checklist li:last-child input`) as HTMLInputElement).focus();
});
$("#form").addEventListener("submit", (e) => {
  e.preventDefault();
  save();
});
$("#search").addEventListener("input", () => {
  filter = $<HTMLInputElement>("#search").value;
  renderList();
});

// The Insert menu: it puts a starter line at the end of the notes.
const menu = $("#insert-menu");
const openMenu = (open: boolean) => {
  menu.hidden = !open;
  $("#insert").setAttribute("aria-expanded", String(open));
  if (open) (menu.querySelector("button") as HTMLButtonElement).focus();
};
$("#insert").addEventListener("click", () => openMenu(menu.hidden));
menu.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
  b.addEventListener("click", () => {
    openMenu(false);
    const l = current();
    if (!l) return;
    const notes = $<HTMLTextAreaElement>("#notes");
    notes.value = (notes.value ? `${notes.value}\n` : "") + b.dataset.text;
    l.notes = notes.value;
    changed();
    notes.focus();
    notes.setSelectionRange(notes.value.length, notes.value.length);
  }));

// The Lesson settings dialog.
const dialog = $("#dialog");
const showDialog = (open: boolean) => {
  dialog.hidden = !open;
  $("#scrim").hidden = !open;
  if (open) {
    const l = current();
    $<HTMLInputElement>("#share").checked = !!l?.shared;
    $<HTMLInputElement>("#reminder").checked = false;
    $<HTMLInputElement>("#share").focus();
  } else $("#settings").focus();
};
$("#settings").addEventListener("click", () => {
  if (!current()) return status("Choose a lesson first");
  showDialog(true);
});
$("#cancel").addEventListener("click", () => showDialog(false));
$("#ok").addEventListener("click", () => {
  const l = current();
  if (l) l.shared = $<HTMLInputElement>("#share").checked;
  showDialog(false);
  changed();
  status(l?.shared ? "This lesson will be shared with the class page" : "Settings changed");
});

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save();
  } else if (e.key === "Escape") {
    if (!dialog.hidden) showDialog(false);
    else if (!menu.hidden) openMenu(false);
  }
});

function loadDemo(name: string) {
  const demo = DEMO_PROJECTS.find((d) => d.name === name);
  if (!demo) throw new Error(`The demo library has no project called "${name}".`);
  lessons = demo.lessons.map((l) => ({ ...l, checklist: [...l.checklist] }));
  projectLabel = demo.label;
  filter = "";
  $<HTMLInputElement>("#search").value = "";
  dirty = false;
  select(-1);
  $<HTMLUListElement>("#list").scrollTop = 0;
  status("Ready");
}

function reset() {
  showDialog(false);
  openMenu(false);
  (document.activeElement as HTMLElement | null)?.blur();
}

loadDemo("demo-lessons-01");
void dirty;
// Version 2 (for the release check) renames two controls: new stable names and new words, same behaviour.
if (programVersion(globalThis as unknown as Record<string, unknown>) >= 2) {
  for (const c of VERSION_2_CHANGES) {
    const el = document.querySelector<HTMLElement>(`[data-demo-id="${c.was}"]`);
    if (!el) continue;
    el.dataset.demoId = c.now;
    el.textContent = c.label;
  }
}
startDemoHook({ program: "Practice Planner", loadDemo, reset });
