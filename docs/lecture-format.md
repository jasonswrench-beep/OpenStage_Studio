# Lectures (format version 1)

Built 2026-11-16 (development list item 3: notes or a chapter become a script you approve, then slides, narration,
captions and an MP4). Jason's decision: Studio draws the slides itself.

## The steps

1. **Write.** `Write Lecture.bat` (drag notes or a manual onto it), or the **Lecture** page in the window. Notes are a
   `.md` or `.txt` file; a manual is a documentation project file or a PDF, and one chapter is used. The lecture script
   goes into the work folder's `lectures` folder (never over an existing one).
   - With no AI, fixed rules make it (`src/lecture/write.ts`): in notes, a `# ` line is the lecture's title, each `## `
     line starts a slide, list items are its points and the paragraphs under it are what is said; in a manual's chapter,
     one slide per topic, with its numbered steps as points. More than six points continue on a second slide.
   - With an AI chosen, the AI writes the slides and narration from the same words; Studio checks every answer (the
     format, the limits below, the blocklist) and sends it back with the problems in words until it passes.
2. **Read and approve.** A person reads the lecture (and changes what they like in a text editor), then approves it on the
   Lecture page or with `Approve Lecture.bat`. The approval records their name, the time and a fingerprint of the
   lecture's words: any later change to the words needs a new approval. Every lecture is approved, whoever wrote it.
3. **Make the video.** `Make Lecture.bat`, or **Make the video** on the Lecture page. Studio draws each slide (the helper's
   `slides` command, with the shared core's canvas and Windows' text), speaks the narration, and makes the video exactly as
   it makes a tutorial: the timeline, the MP4, captions (SRT and VTT), the description track, the transcript, chapters,
   the frame scan and its review, the thumbnail and the publishing details. The video is reviewed and exported like any
   other.

## The file

```json
{
  "format": "openstage-studio-lecture",
  "version": 1,
  "title": "How seeds become plants",
  "goal": "You understand how seeds become plants.",
  "course": "Science with Year 4",
  "intro": "Spoken over the title card.",
  "outro": "Spoken over the end card.",
  "slides": [
    {
      "title": "What a seed holds",
      "points": ["A tough seed coat keeps it safe and dry", "The embryo is the young plant itself"],
      "narration": "What is said while the slide shows.",
      "picture": "seed.png",
      "pictureAlt": "A bean seed cut in half, showing the tiny root and shoot inside.",
      "describe": "Anything else the slide shows, for viewers who cannot see it.",
      "chapter": "The seed",
      "hold": 1
    }
  ]
}
```

| Field | Required | What it holds |
|---|---|---|
| `format`, `version` | yes | `"openstage-studio-lecture"`, `1`. |
| `title` | yes | At most 100 characters; on the title card. |
| `goal` | yes | One line: what the viewer understands after watching. |
| `course` | no | At most 60 characters; small, above the title on the cards and every slide. |
| `playlist`, `intro`, `outro`, `publish` | no | As in a tutorial script (`docs/script-format.md`). |
| `source` | no | Where it came from, for people. |
| `writtenBy` | no | `{ "kind": "person" or "model", "name": "..." }`. |
| `approval` | no | Written by Studio when a person approves: `{ "by", "at", "digest" }`. |
| `redactions` | no | Blurred boxes chosen in review, as in a tutorial script; `fromStep` and `toStep` count slides. |
| `slides` | yes | 1 to 100 slides. |

A slide: `title` (at most 80 characters; over 60 takes two lines), `points` (at most six, each at most 100 characters;
more than four is warned as crowded), `narration` (required, at most 1,200 characters; over 700 is warned), `picture` (a
PNG beside the lecture, by its plain file name, never a path; a picture you own), `pictureAlt` (required with a picture,
at most 250 characters), `describe` (at most 280 characters), `chapter`, `hold` (0 to 10 seconds after the narration).
Unknown fields are errors.

## What the viewer gets

- The title card (the course, the title, the goal) with the intro spoken over it; each slide for as long as its narration
  and its `hold`; the end card with the outro.
- **Captions** from the narration, as for every video.
- **The description track** (`descriptions.vtt`): for each slide, its title, its points, what its picture shows and its
  `describe`, so a viewer who cannot see the slides is told what they hold; spoken description waits for the shared
  speech engine (`CORE-REQUESTS.md`, S1).
- **The transcript**, with what is said and what each slide shows.
- **Chapters** from the slides' `chapter`.

The script scan reads everything a viewer sees or hears (the titles, points, course, narration, picture descriptions,
`describe`), and the frame scan reads the drawn slides, before the video can be exported.

## How it is made

`src/lecture/make-lecture.ts` turns the lecture into a tutorial-shaped script (one `wait` step per slide, its
narration and its description) and the drawn slides into a take's pictures, then calls the same `makeVideo` every
tutorial uses, with no pointer. So a lecture video gets every check and every file a tutorial does, and the same
lecture always gives the same video (`Check Lecture.bat` makes it twice and compares them).

The slides' look: a light background, dark words, the accent colour for the bar and the bullets, the slide's number in
the corner. One look for now; a project setting for colours can follow.
