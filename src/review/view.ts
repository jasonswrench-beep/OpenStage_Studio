// The review gate in OpenStage Studio's window: a person looks at every flag the scans raised, decides what to do with
// each (approve it, blur it, or record again), approves the video, and exports its publishing package. Export stays shut
// until every flag is resolved and a person has approved; the window and the command line apply the same rules
// (src/guard/review.ts). Everything here works by keyboard, and every state is said in words, not by colour alone.

import { open } from "@tauri-apps/plugin-dialog";
import { copyFile, exists, mkdir, readDir, readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { CATEGORIES } from "../guard/blocklist.ts";
import { timeOf, type Flag } from "../guard/frame-scan.ts";
import { grow } from "../guard/redact.ts";
import { ACTION_WORDS, approve, decide, flagState, gate, guardReport, STATE_WORDS, type Action, type Review } from "../guard/review.ts";
import { checklistText, uploadText, type PublishDraft, type VideoRecord } from "../package/package.ts";
import { addRedaction } from "../script/edit.ts";
import { onADrive } from "./script-path.ts";

const PACKAGE_COPIES = ["captions.srt", "captions.vtt", "transcript.txt", "thumbnail.png"];
/** Copied when the video has them (the description track; videos made before 2026-11-15 have none). */
const PACKAGE_EXTRAS = ["descriptions.vtt"];
const NAME_KEY = "openstage-studio.reviewer";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

const now = () => new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Open a video's review in `host`. `announce` puts a short message in the window's status line. */
export async function showReview(host: HTMLElement, folder: string, announce: (s: string) => void): Promise<void> {
  host.innerHTML = "";
  let review = JSON.parse(await readTextFile(await join(folder, "review.json"))) as Review;
  const urls: string[] = [];
  const blobUrl = (bytes: Uint8Array, type: string) => {
    const u = URL.createObjectURL(new Blob([bytes as unknown as ArrayBuffer], { type }));
    urls.push(u);
    return u;
  };

  const heading = el("h2", { id: "review-h", tabIndex: -1 }, `Review: ${review.title}`);
  const gateLine = el("p", { className: "gate", id: "gate" });
  gateLine.setAttribute("role", "status");
  const who = el("input", { id: "who", type: "text", autocomplete: "name", value: storedName() });
  who.addEventListener("change", () => {
    try {
      localStorage.setItem(NAME_KEY, who.value.trim());
    } catch {
      // Remembering the name is a convenience only.
    }
  });
  const whoLabel = el("label", { htmlFor: "who" }, "Your name (recorded with every decision and the approval)");
  const about = el("p", { className: "muted" }, `${review.video}. Narration: ${review.narration}. Script written by ${review.writtenBy}.`);

  // The video, with its captions.
  const video = el("video", { controls: true, preload: "metadata", className: "player" });
  video.setAttribute("aria-label", `The video: ${review.title}`);
  try {
    video.src = blobUrl(await readFile(await join(folder, review.video)), "video/mp4");
    const vtt = await readTextFile(await join(folder, "captions.vtt"));
    video.append(el("track", { kind: "captions", srclang: "en", label: "English", default: true, src: blobUrl(new TextEncoder().encode(vtt), "text/vtt") }));
  } catch (e) {
    video.replaceWith(el("p", {}, `The video could not be opened here: ${String(e)}`));
  }
  const seek = (frame: number) => {
    video.currentTime = frame / review.fps + 0.01;
    video.pause();
    video.focus();
  };

  const flagsHeading = el("h3", { id: "flags-h" });
  const flagList = el("ol", { className: "flags" });
  flagList.setAttribute("aria-labelledby", "flags-h");

  const approveButton = el("button", { type: "button", id: "approve" }, "Approve this video");
  const exportButton = el("button", { type: "button", id: "export" }, "Export the package…");
  const exportNote = el("p", { id: "export-note", className: "muted" });
  approveButton.setAttribute("aria-describedby", "gate export-note");
  exportButton.setAttribute("aria-describedby", "gate export-note");

  const section = el("section", { className: "review" }, heading, about, gateLine, el("div", { className: "who" }, whoLabel, who), video,
    flagsHeading, flagList,
    el("h3", {}, "Approve and export"),
    el("p", { className: "muted" }, "Watch the whole video before approving it. Approval records your name; export makes the upload package in a folder you choose. The guard report stays here, beside the video."),
    el("div", { className: "actions" }, approveButton, exportButton), exportNote);
  section.setAttribute("aria-labelledby", "review-h");
  host.append(section);

  const needName = (): string | null => {
    const name = who.value.trim();
    if (!name) {
      announce("Type your name first: every decision records who made it.");
      who.focus();
      return null;
    }
    return name;
  };

  const save = async () => {
    await writeTextFile(await join(folder, "review.json"), JSON.stringify(review, null, 2));
    await writeTextFile(await join(folder, "guard-report.txt"), guardReport(review));
  };

  const setDisabled = (b: HTMLButtonElement, off: boolean) => {
    // aria-disabled keeps the button in the keyboard order, so a screen reader user can still find it and hear why.
    b.setAttribute("aria-disabled", String(off));
    b.classList.toggle("off", off);
  };

  const render = async () => {
    const g = gate(review);
    gateLine.textContent = `${g.open ? "✓" : "✗"} ${g.says}`;
    gateLine.className = `gate ${g.open ? "open" : "shut"}`;
    flagsHeading.textContent = review.flags.length ? `Flags (${review.flags.length})` : "Flags (none)";
    setDisabled(approveButton, !g.resolved || !!review.approval);
    approveButton.textContent = review.approval ? `Approved by ${review.approval.by}` : "Approve this video";
    setDisabled(exportButton, !g.open);
    exportNote.textContent = g.open ? "" : !g.resolved ? "Export opens when every flag is resolved and the video is approved." : review.approval ? "" : "Approve the video to open export.";
    flagList.innerHTML = "";
    if (!review.flags.length) flagList.append(el("li", { className: "none" }, "The scans found nothing blocked in this video. Watch it, then approve it."));
    for (const [i, f] of review.flags.entries()) flagList.append(await flagItem(f, i));
  };

  const flagItem = async (f: Flag, i: number) => {
    const d = review.decisions[f.id];
    const state = flagState(f, d);
    const id = `flag-${f.id}`;
    const title = f.how === "pattern" ? f.term[0].toUpperCase() + f.term.slice(1) : `${f.term} (${CATEGORIES[f.category].toLowerCase()})`;
    const symbol = state === "approved" || state === "blurred" ? "✓" : state === "open" ? "○" : "…";
    const where = `${f.steps[0] === f.steps[1] ? `step ${f.steps[0]}` : `steps ${f.steps[0]} to ${f.steps[1]}`}`;
    const sources = [...new Set(f.sightings.map((s) => (s.source === "picture" ? "read from the picture" : "reported by the program")))].join(" and ");
    const first = f.sightings[0];
    // The picture it was seen in, with the place outlined.
    const figure = el("figure", { className: "shot" });
    try {
      const img = el("img", { alt: `The picture at ${timeOf(f.shown[0][0], review.fps)}, with "${f.found}" outlined.` });
      img.src = blobUrl(await readFile(await join(folder, "take", `${first.picture}.png`)), "image/png");
      const mark = el("div", { className: "mark" });
      mark.setAttribute("aria-hidden", "true");
      Object.assign(mark.style, { left: `${(f.rect[0] / 1920) * 100}%`, top: `${(f.rect[1] / 1080) * 100}%`, width: `${(f.rect[2] / 1920) * 100}%`, height: `${(f.rect[3] / 1080) * 100}%` });
      figure.append(el("div", { className: "frame" }, img, mark), el("figcaption", {}, "Outlined: the flagged words."));
    } catch {
      figure.append(el("figcaption", {}, "The picture could not be shown."));
    }
    const note = el("input", { type: "text", id: `${id}-note`, value: d?.note ?? "" });
    const buttons = (["approve", "blur", "rerecord"] as Action[]).map((a) => {
      const b = el("button", { type: "button" }, ACTION_WORDS[a]);
      b.setAttribute("aria-pressed", String(d?.action === a));
      b.addEventListener("click", () => void choose(f, a, note.value, i));
      return b;
    });
    const show = el("button", { type: "button", className: "quiet" }, "Show this moment in the video");
    show.addEventListener("click", () => seek(f.shown[0][0]));
    const decided = d ? ` Decided by ${d.by} on ${d.at}${d.carried ? " (carried from an earlier run with the same pictures)" : ""}${d.note ? `: ${d.note}` : ""}.` : "";
    const group = el("div", { className: "choices" }, ...buttons);
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", `Decision for flag ${i + 1}`);
    const article = el("article", {},
      el("h4", { id: `${id}-h`, tabIndex: -1 }, `Flag ${i + 1}: ${title}`),
      el("p", { className: `state ${state}` }, `${symbol} ${STATE_WORDS[state]}.${decided}`),
      el("p", {}, `Seen as "${f.found}", first at ${timeOf(f.shown[0][0], review.fps)} (${where}), ${sources}.${f.note ? ` ${f.note}` : ""}`),
      figure, show,
      el("div", { className: "note" }, el("label", { htmlFor: note.id }, "Note (optional)"), note),
      group,
    );
    article.setAttribute("aria-labelledby", `${id}-h`);
    return el("li", { id }, article);
  };

  const choose = async (f: Flag, action: Action, note: string, i: number) => {
    const name = needName();
    if (!name) return;
    try {
      if (action === "blur") {
        const box = grow(f.rect, 8);
        const reason = `${f.how === "pattern" ? f.term : `"${f.term}"`} (flag ${f.id})`;
        await blurInScript(review.script, { box, fromStep: f.steps[0], toStep: f.steps[1], reason });
      }
      review = decide(review, f.id, action, name, now(), note);
      await save();
      await render();
      announce(action === "blur"
        ? `Flag ${i + 1}: a blurred box was added to the script. Make the video again (Make Video.bat) so the video has it; the flag then counts as resolved.`
        : `Flag ${i + 1}: ${ACTION_WORDS[action].toLowerCase()}. ${gate(review).says}`);
      document.querySelector<HTMLElement>(`#flag-${f.id} h4`)?.focus();
    } catch (e) {
      announce(`That decision was not saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  approveButton.addEventListener("click", async () => {
    if (approveButton.getAttribute("aria-disabled") === "true") return announce(review.approval ? `Already approved by ${review.approval.by}.` : gate(review).says);
    const name = needName();
    if (!name) return;
    try {
      review = approve(review, name, now());
      await save();
      await render();
      announce(`Approved by ${name}. Export is open.`);
      exportButton.focus();
    } catch (e) {
      announce(e instanceof Error ? e.message : String(e));
    }
  });

  exportButton.addEventListener("click", async () => {
    if (exportButton.getAttribute("aria-disabled") === "true") return announce(gate(review).says);
    try {
      announce("Checking the video is the one that was reviewed.");
      const bytes = await readFile(await join(folder, review.video));
      if ((await sha256(bytes)) !== review.videoDigest) return announce("The video has changed since it was reviewed. Make it again and review it again.");
      const outRoot = await open({ directory: true, recursive: true, title: "Choose where the upload package goes" });
      if (typeof outRoot !== "string") return announce("Export cancelled.");
      const { folderName, ...draft } = JSON.parse(await readTextFile(await join(folder, "publish.json"))) as PublishDraft;
      const record: VideoRecord = { ...draft, approvedBy: review.approval!.by };
      const target = await join(outRoot, folderName);
      await mkdir(target, { recursive: true });
      await copyFile(await join(folder, review.video), await join(target, "video.mp4"));
      for (const f of PACKAGE_COPIES) await copyFile(await join(folder, f), await join(target, f));
      for (const f of PACKAGE_EXTRAS) if (await exists(await join(folder, f))) await copyFile(await join(folder, f), await join(target, f));
      await writeTextFile(await join(target, "upload.txt"), uploadText(record));
      await writeTextFile(await join(target, "video.json"), JSON.stringify(record, null, 2) + "\n");
      // The checklist covers every package in that folder, in playlist order.
      const entries: { folder: string; record: VideoRecord }[] = [];
      for (const entry of await readDir(outRoot)) {
        const vj = await join(outRoot, entry.name, "video.json");
        if (entry.isDirectory && (await exists(vj))) entries.push({ folder: entry.name, record: JSON.parse(await readTextFile(vj)) as VideoRecord });
      }
      await writeTextFile(await join(outRoot, "checklist.txt"), checklistText(entries));
      await save();
      announce(`Exported to ${target}. The upload checklist is in ${outRoot}.`);
    } catch (e) {
      announce(`The package was not made: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  await render();
  heading.focus();
}

/** Add a blurred box to the script. If the window may not write it, or its path is not a plain one on this computer, the
 * person is asked to choose the script. */
async function blurInScript(script: string, redaction: { box: [number, number, number, number]; fromStep: number; toStep: number; reason: string }) {
  let path = script;
  let text: string;
  const local = onADrive(script);
  try {
    if (!local) throw new Error("not a path on this computer");
    text = await readTextFile(path);
  } catch {
    const chosen = await open({ multiple: false, ...(local ? { defaultPath: script } : {}), title: "Choose this video's script, to add the blurred box to it", filters: [{ name: "Tutorial script", extensions: ["json"] }] });
    if (typeof chosen !== "string") throw new Error("no script was chosen.");
    path = chosen;
    text = await readTextFile(path);
  }
  await writeTextFile(path, addRedaction(text, redaction));
}
