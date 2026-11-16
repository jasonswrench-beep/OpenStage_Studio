// A person's approval of a lecture (src/lecture/format.ts): it holds for exactly the words approved. On this computer
// only (Node); the window asks the engine to approve.

import { createHash } from "node:crypto";
import type { Lecture } from "./format.ts";

/** A fingerprint of the lecture's words (everything but the approval, and the blurred boxes a person chose in review), so
 * an approval holds for exactly this text. */
export function lectureDigest(l: Lecture | Record<string, unknown>): string {
  const { approval: _approval, redactions: _boxes, ...rest } = l as Record<string, unknown>;
  void _approval;
  void _boxes;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

/** Whether the lecture may be made into a video: a person has approved it, and it has not changed since. Every lecture
 * is approved first, whoever wrote it (the development list: "a script you approve"). */
export function approvalState(l: Lecture): { ok: boolean; says: string } {
  if (l.approval) {
    if (l.approval.digest === lectureDigest(l)) return { ok: true, says: `Approved by ${l.approval.by} (${l.approval.at}).` };
    return { ok: false, says: `It was approved by ${l.approval.by}, but it has changed since. A person approves it again before the video is made.` };
  }
  if (l.writtenBy?.kind === "model") return { ok: false, says: "The AI wrote it, so a person reads and approves it before the video is made." };
  return { ok: false, says: "A person reads and approves the lecture before the video is made." };
}

/** The lecture with a person's approval of its present content. */
export function approve(l: Lecture, by: string, at: string): Lecture {
  if (!by.trim()) throw new Error("An approval needs the name of the person approving.");
  return { ...l, approval: { by: by.trim(), at, digest: lectureDigest(l) } };
}
