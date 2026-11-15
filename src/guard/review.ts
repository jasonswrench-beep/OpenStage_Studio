// The review gate: a person looks at every flag the scans raised and decides what to do with it, then approves the video.
// Export stays shut until every flag is resolved and a person has approved the video. AI never approves anything here.
//
// The review is kept beside the video as review.json, and a guard report (guard-report.txt) says what the scans did,
// what they found, how each flag was resolved and who approved. The report stays with the project; it is never part of
// the video or the publishing package.

import { CATEGORIES } from "./blocklist.ts";
import { timeOf, type Flag } from "./frame-scan.ts";

export const REVIEW_FORMAT = "openstage-studio-review";

export type Action = "approve" | "blur" | "rerecord";

export const ACTION_WORDS: Record<Action, string> = {
  approve: "Approve: it may show",
  blur: "Blur it",
  rerecord: "Record again",
};

export interface Decision {
  action: Action;
  /** Who decided: a person's name. */
  by: string;
  /** When, as a date and time. */
  at: string;
  note?: string;
  /** Set when the decision was made on an earlier run that gave the very same pictures. */
  carried?: boolean;
}

export interface Review {
  format: typeof REVIEW_FORMAT;
  version: 1;
  /** The video's file name, beside this file. */
  video: string;
  /** A fingerprint of the video file, so a review can never pass for a different video. */
  videoDigest: string;
  /** The script, as given to make the video. */
  script: string;
  title: string;
  fps: number;
  /** How the narration was made, for disclosure when it is uploaded. */
  narration: string;
  writtenBy: string;
  scans: {
    script: { ran: boolean; checked: number; hits: number };
    frames: { ran: boolean; pictures: number; read: string; pageText: boolean };
    blocklist: { terms: number; patterns: boolean; files: string[] };
  };
  flags: Flag[];
  decisions: Record<string, Decision>;
  /** The person's approval of the whole video, once every flag is resolved. */
  approval?: { by: string; at: string };
}

export type FlagState = "open" | "approved" | "blurred" | "blur-pending" | "rerecord";

/** Where a flag stands. A blur counts only once the video itself has the box over it. */
export function flagState(flag: Flag, decision: Decision | undefined): FlagState {
  if (flag.covered) return "blurred";
  if (!decision) return "open";
  if (decision.action === "approve") return "approved";
  if (decision.action === "blur") return "blur-pending";
  return "rerecord";
}

export const STATE_WORDS: Record<FlagState, string> = {
  open: "Not decided yet",
  approved: "Approved: may show",
  blurred: "Blurred in the video",
  "blur-pending": "Blur chosen: make the video again to apply it",
  rerecord: "To be recorded again",
};

export interface Gate {
  /** Every flag is resolved (approved, or blurred in the video). */
  resolved: boolean;
  /** Resolved and approved by a person: the video may be exported. */
  open: boolean;
  waiting: Flag[];
  /** Why export is shut, in words, or that it is open. */
  says: string;
}

export function gate(review: Review): Gate {
  const waiting = review.flags.filter((f) => {
    const s = flagState(f, review.decisions[f.id]);
    return s !== "approved" && s !== "blurred";
  });
  const resolved = waiting.length === 0;
  const open = resolved && !!review.approval;
  let says: string;
  if (!resolved) {
    const pending = waiting.filter((f) => flagState(f, review.decisions[f.id]) === "blur-pending").length;
    const again = waiting.filter((f) => flagState(f, review.decisions[f.id]) === "rerecord").length;
    const undecided = waiting.length - pending - again;
    const parts = [
      undecided && `${undecided} flag${undecided === 1 ? "" : "s"} not decided yet`,
      pending && `${pending} blur${pending === 1 ? "" : "s"} waiting for the video to be made again`,
      again && `${again} flag${again === 1 ? "" : "s"} to be recorded again`,
    ].filter(Boolean);
    says = `Export is shut: ${parts.join(", ")}.`;
  } else if (!open) says = "Every flag is resolved. Export opens once a person approves the video.";
  else says = `Export is open: approved by ${review.approval!.by}.`;
  return { resolved, open, waiting, says };
}

/** Record a decision on a flag. A decision needs a person's name. */
export function decide(review: Review, flagId: string, action: Action, by: string, at: string, note?: string): Review {
  if (!by.trim()) throw new Error("Say who is deciding: a person's name.");
  if (!review.flags.some((f) => f.id === flagId)) throw new Error(`There is no flag ${flagId} in this review.`);
  const decisions = { ...review.decisions, [flagId]: { action, by: by.trim(), at, ...(note?.trim() ? { note: note.trim() } : {}) } };
  // A change to any flag takes back the approval of the whole video.
  const { approval: _dropped, ...rest } = review;
  void _dropped;
  return { ...rest, decisions };
}

/** Approve the whole video. Only possible once every flag is resolved. */
export function approve(review: Review, by: string, at: string): Review {
  if (!by.trim()) throw new Error("Say who is approving: a person's name.");
  const g = gate(review);
  if (!g.resolved) throw new Error(g.says);
  return { ...review, approval: { by: by.trim(), at } };
}

/** Bring decisions from an earlier review of the same pictures into a new one. The video's approval never carries. */
export function carryDecisions(fresh: Review, earlier: Review | null): Review {
  if (!earlier) return fresh;
  const decisions: Record<string, Decision> = {};
  for (const f of fresh.flags) {
    const d = earlier.decisions[f.id];
    if (d) decisions[f.id] = { ...d, carried: true };
  }
  return { ...fresh, decisions };
}

/** The guard report, in words. */
export function guardReport(review: Review): string {
  const g = gate(review);
  const s = review.scans;
  const lines = [
    `Guard report: ${review.title}`,
    `Video: ${review.video} (fingerprint ${review.videoDigest.slice(0, 16)})`,
    `Script: ${review.script}, written by ${review.writtenBy}`,
    `Narration: ${review.narration}`,
    "",
    "Scans run",
    `- Blocklist: ${s.blocklist.terms} blocked term${s.blocklist.terms === 1 ? "" : "s"}${s.blocklist.patterns ? ", and the built-in patterns (file paths, email addresses, phone numbers)" : ", built-in patterns switched off"}; from ${s.blocklist.files.length ? s.blocklist.files.join(", ") : "no blocklist file"} and this computer's user name and home folder.`,
    `- Script scan: ${s.script.ran ? `${s.script.checked} pieces of text checked, ${s.script.hits} hit${s.script.hits === 1 ? "" : "s"}` : "not run"}.`,
    `- Frame scan: ${s.frames.ran ? `${s.frames.pictures} pictures read with ${s.frames.read}${s.frames.pageText ? ", and the text each page reported" : ""}` : "not run"}.`,
    "",
    `Flags raised: ${review.flags.length}`,
  ];
  review.flags.forEach((f, i) => {
    const d = review.decisions[f.id];
    const state = flagState(f, d);
    const what = f.how === "pattern" ? `${f.term}: "${f.found}"` : `"${f.term}" (${CATEGORIES[f.category].toLowerCase()})${f.found.toLowerCase() !== f.term.toLowerCase() ? `, seen as "${f.found}"` : ""}`;
    lines.push(`${i + 1}. [${f.id}] ${what}`);
    lines.push(`   First shown at ${timeOf(f.shown[0][0], review.fps)} (frame ${f.shown[0][0]}), ${f.steps[0] === f.steps[1] ? `step ${f.steps[0]}` : `steps ${f.steps[0]} to ${f.steps[1]}`}, at ${f.rect.join(", ")}; seen in ${new Set(f.sightings.map((x) => x.picture)).size} picture(s) (${[...new Set(f.sightings.map((x) => x.source === "picture" ? "read from the picture" : "reported by the page"))].join(" and ")}).`);
    lines.push(`   Resolution: ${STATE_WORDS[state]}${d ? `, decided by ${d.by} on ${d.at}${d.carried ? " (carried from an earlier run with the same pictures)" : ""}${d.note ? `: ${d.note}` : ""}` : ""}.`);
  });
  lines.push("", review.approval ? `Approved for export by ${review.approval.by} on ${review.approval.at}.` : "Not approved for export yet.", g.says, "");
  return lines.join("\n");
}
