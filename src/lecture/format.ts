// The lecture script (development list item 3): notes or a manual's chapter become slides with narration, which a person
// approves, and Studio makes the video (slides drawn by Studio, narration, captions, a description track and an MP4).
// One JSON file fully describes one lecture video, like a tutorial script (docs/lecture-format.md).

import type { Publish, Redaction } from "../script/format.ts";

export const LECTURE_FORMAT = "openstage-studio-lecture";
export const LECTURE_VERSION = 1;

export interface Slide {
  /** The slide's heading, at most 80 characters. */
  title: string;
  /** Up to six short points, each at most 100 characters. A slide may have none (a title slide, or a picture). */
  points?: string[];
  /** A picture you own, a PNG file beside the lecture (a plain file name, never a path). */
  picture?: string;
  /** What the picture shows, for viewers who cannot see it. Required with a picture. */
  pictureAlt?: string;
  /** What is said while the slide shows: a paragraph, at most 1,200 characters. */
  narration: string;
  /** For viewers who cannot see the screen: anything the slide shows that the narration does not say. */
  describe?: string;
  /** Starts a chapter of the video here. */
  chapter?: string;
  /** Extra pause after the narration, 0 to 10 seconds. */
  hold?: number;
}

export interface Lecture {
  format: typeof LECTURE_FORMAT;
  version: number;
  title: string;
  /** One line: what the viewer can do or understand after watching. */
  goal: string;
  /** Shown above the title on the title card and the slides, such as the course's name. */
  course?: string;
  playlist?: { name: string; position: number };
  intro?: string;
  outro?: string;
  /** Where the lecture came from, for people (Studio does not read it). */
  source?: { kind: "notes" | "manual"; file: string; chapter?: string };
  writtenBy?: { kind: "person" | "model"; name?: string; editedByPerson?: boolean };
  /** A person's approval of exactly this lecture. A lecture the AI wrote is made into a video only once approved. */
  approval?: { by: string; at: string; digest: string };
  publish?: Publish;
  /** Blurred boxes chosen in review, as in a tutorial script; `fromStep` and `toStep` count slides. */
  redactions?: Redaction[];
  slides: Slide[];
}
