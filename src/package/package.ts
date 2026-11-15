// The publishing package: everything needed to upload one video by hand through a video site's normal upload page.
// Nothing here talks to any site. These are plain functions, shared by the command line and the app.
//
//   NN-<name>/video.mp4        the video (1080p)
//             captions.srt     the caption track, to upload in place of automatic captions (captions.vtt is there too)
//             thumbnail.png    1280 by 720, from the product's template
//             upload.txt       title, description (with the chapter list), tags, playlist and position, how it was narrated
//             transcript.txt   the plain transcript, to link from the description or post with the manual
//             video.json       the same details, for tools
//
// A batch export also writes checklist.txt: what to upload where, video by video, in playlist order.

import type { Script } from "../script/format.ts";

export interface ProjectPublishSettings {
  /** Add a line to each description saying the narration is computer generated. Off unless a project turns it on. */
  disclosureLine?: boolean;
  /** The words of that line. */
  disclosureText?: string;
  /** The thumbnail template for this product. */
  thumbnail?: ThumbnailTemplate;
}

export interface ThumbnailTemplate {
  background?: string;
  accent?: string;
  color?: string;
  /** The words above the title; the program's name if left out. */
  kicker?: string;
  /** A line at the foot, such as the playlist's name. Left out if empty. */
  footer?: string;
}

export const DEFAULT_TEMPLATE: Required<Omit<ThumbnailTemplate, "kicker" | "footer">> = {
  background: "#102037",
  accent: "#FF7BCC",
  color: "#FFFFFF",
};

export const DEFAULT_DISCLOSURE = "The narration in this video is computer generated.";

export interface VideoRecord {
  title: string;
  description: string;
  tags: string[];
  playlist?: { name: string; position: number };
  /** How the narration was made, so the upload's disclosure can be set correctly. */
  narration: string;
  chapters: string;
  approvedBy: string;
  files: Record<string, string>;
}

/** A folder name from the playlist position and the script's name: `03-plan-a-lesson`. */
export function packageFolderName(script: Script, scriptName: string): string {
  const n = script.playlist?.position;
  const slug = scriptName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "video";
  return `${n ? String(n).padStart(2, "0") : "00"}-${slug}`;
}

/** The description: the script's own words (or its goal), the chapter list, and the optional narration line. */
export function makeDescription(script: Script, chapters: string, settings: ProjectPublishSettings = {}): string {
  const parts = [script.publish?.description?.trim() || script.goal.trim()];
  // Video sites make chapters from a list of three or more times; a shorter list would only clutter the description.
  if (chapters.trim().split("\n").length >= 3) parts.push(`Chapters\n${chapters.trim()}`);
  parts.push("Captions are written from the script. A plain transcript comes with this video.");
  if (settings.disclosureLine) parts.push(settings.disclosureText?.trim() || DEFAULT_DISCLOSURE);
  return parts.join("\n\n") + "\n";
}

/** The publishing details as they stood when the video was made (publish.json beside the video). The export adds who
 * approved it. Taken at that moment so a later edit to the script cannot change what goes with this video. */
export type PublishDraft = Omit<VideoRecord, "approvedBy"> & { folderName: string };

export function makeDraft(script: Script, scriptName: string, chapters: string, narration: string, settings: ProjectPublishSettings = {}): PublishDraft {
  const { approvedBy: _unused, ...rest } = makeRecord(script, chapters, narration, "", settings);
  void _unused;
  return { folderName: packageFolderName(script, scriptName), ...rest };
}

export function makeRecord(script: Script, chapters: string, narration: string, approvedBy: string, settings: ProjectPublishSettings = {}): VideoRecord {
  return {
    title: script.title,
    description: makeDescription(script, chapters, settings),
    tags: script.publish?.tags ?? [],
    ...(script.playlist ? { playlist: script.playlist } : {}),
    narration,
    chapters,
    approvedBy,
    files: { video: "video.mp4", captions: "captions.srt", captionsVtt: "captions.vtt", thumbnail: "thumbnail.png", transcript: "transcript.txt" },
  };
}

/** upload.txt: each field to paste, in the order the upload page asks for them. */
export function uploadText(r: VideoRecord): string {
  return [
    "UPLOAD DETAILS",
    "",
    "Video file: video.mp4",
    "",
    "Title:",
    r.title,
    "",
    "Description (paste as it is; the chapter list makes the video's chapters):",
    r.description.trim(),
    "",
    `Tags: ${r.tags.length ? r.tags.join(", ") : "(none given)"}`,
    "",
    `Playlist: ${r.playlist ? `${r.playlist.name}, position ${r.playlist.position}` : "(none given)"}`,
    "",
    "Thumbnail: thumbnail.png",
    "",
    "Captions: upload captions.srt as the video's caption track, so it replaces automatic captions.",
    "",
    `Narration: ${r.narration}. It is a generic computer voice describing real footage of the program, not a real person's voice. Set the upload's disclosure question to match.`,
    "",
    "Transcript: transcript.txt, to link from the description or post with the manual.",
    "",
    `Approved for upload by ${r.approvedBy}.`,
    "",
  ].join("\n");
}

/** checklist.txt for a batch: one block per video, in playlist order. */
export function checklistText(entries: { folder: string; record: VideoRecord }[]): string {
  const sorted = [...entries].sort((a, b) => a.folder.localeCompare(b.folder));
  const lines = ["UPLOAD CHECKLIST", "", "Upload each video through the channel's normal upload page, in this order. Tick each line as you go.", ""];
  for (const { folder, record } of sorted) {
    lines.push(
      `${folder}: ${record.title}`,
      "  [ ] Upload video.mp4",
      "  [ ] Paste the title, description and tags from upload.txt",
      "  [ ] Set thumbnail.png as the thumbnail",
      "  [ ] Upload captions.srt as the caption track",
      `  [ ] ${record.playlist ? `Add to the playlist "${record.playlist.name}" at position ${record.playlist.position}` : "No playlist given"}`,
      "  [ ] Answer the disclosure question for computer-generated narration (see upload.txt)",
      "  [ ] Keep it private, look at it once more, then publish",
      "",
    );
  }
  return lines.join("\n");
}

// Thumbnails ----------------------------------------------------------------------------------------------------------

/** How bright a colour looks (relative luminance), from #RRGGBB. */
function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

/** The contrast between two colours, from 1 (none) to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const COLOUR = /^#[0-9A-Fa-f]{6}$/;

/** The thumbnail's plan for the helper, and warnings about its colours (a warning, never a block). */
export function thumbnailPlan(script: Script, template: ThumbnailTemplate | undefined, picture: string | null, focus: [number, number] | null, redactions: [number, number, number, number][]) {
  const t = { ...DEFAULT_TEMPLATE, ...template };
  const warnings: string[] = [];
  for (const key of ["background", "accent", "color"] as const) {
    if (!COLOUR.test(t[key])) {
      warnings.push(`The thumbnail's ${key} "${t[key]}" is not a colour like #102037; the default is used.`);
      t[key] = DEFAULT_TEMPLATE[key];
    }
  }
  const words = contrast(t.color, t.background);
  if (words < 4.5) warnings.push(`The thumbnail's title has a contrast of ${words.toFixed(1)} to 1 against its background (4.5 to 1 is suggested). It is kept as it is.`);
  const kicker = contrast(t.accent, t.background);
  if (kicker < 3) warnings.push(`The thumbnail's product name has a contrast of ${kicker.toFixed(1)} to 1 against its background (3 to 1 is suggested). It is kept as it is.`);
  return {
    plan: {
      width: 1280, height: 720, background: t.background, accent: t.accent, color: t.color,
      kicker: template?.kicker ?? script.program.name, title: script.title, footer: template?.footer ?? (script.playlist ? script.playlist.name : ""),
      ...(picture ? { picture } : {}), ...(focus ? { focus } : {}), redactions,
    },
    warnings,
  };
}
