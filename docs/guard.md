# The guard, the review gate and the publishing package

The guard keeps proprietary material out of the videos: it stops it being recorded in the first place, scans for anything
that slipped through, and then needs a person to approve. No scan can promise a clean video, so the person is the last
step and is never skipped. The code is in `src/guard/` and `src/package/`.

## The layers

| Layer | What it does | Where |
|---|---|---|
| Window-only capture | Records the program's window and nothing else. | `studio-helper take` (phase 1) |
| Demo workspace | Scripts open invented demo projects by name, never a file path; programs open them in a workspace made for the take. | `src/script/validate.ts`, `src/pipeline/programs.ts` |
| This computer's own details | The user name, home folder and computer name are blocked without anyone writing them down. | `src/guard/load.ts` |
| Script scan | Before anything is recorded, checks every word a viewer will see or hear against the blocklist. A hit stops the script. | `src/guard/script-scan.ts` |
| Frame scan | After the take, reads the text in every picture and checks it. Each hit becomes a flag. | `src/guard/frame-scan.ts`, `studio-helper ocr` |
| Review gate | A person decides every flag (approve, blur, or record again) and approves the video. Export stays shut until then. | `src/guard/review.ts`, `src/review/view.ts` |
| Guard report | What ran, what was found, how each flag was resolved and who approved. It stays beside the video, never in it. | `guard-report.txt` |

A separate recording account is not required (decided 2026-11-14): the demo workspace and the checks for this computer's
own details do that job. A recording-only Windows account remains a good extra step for anyone who wants it.

## The blocklist

The repository ships the categories and the patterns, never names. Names of other companies' products, real people and
real institutions go in each person's own file, `blocklist.local.json` beside the project, which git ignores
(`Edit Blocklist.bat` starts one and opens it):

```json
{
  "format": "openstage-studio-blocklist",
  "version": 1,
  "byCategory": { "product": ["..."], "person": ["..."], "institution": ["..."], "path": [], "other": [] },
  "allow": ["Our Own Product"]
}
```

- **Categories**: product, person, institution, path, other. Terms can also be written as `"terms": [{ "text": "...",
  "category": "product", "note": "why" }]`.
- **Allowlist**: your own names, never flagged (OpenStage, OpenStage Studio, OpenStage Author, OpenScreen and Practice
  Planner are built in). A hit inside an allowed name is not a hit.
- **Built-in patterns**: a path into a user folder, any full file path, a network share, an environment folder such as
  `%APPDATA%`, an email address (except at example domains such as example.com, which demo content should use), and a
  phone number (except 555-0100 to 555-0199). `"patterns": false` turns them off.
- **Matching** ignores case, accents, spacing and punctuation, merges letters that text recognition confuses (0 and o,
  1, l, i and |, 5 and s, rn and m, vv and w), allows one letter wrong in a name of six to nine letters and two in a longer
  one, and finds a long name cut off at the edge of a line. Names of five letters or fewer must match exactly, so short
  names do not catch ordinary words.
- More lists can be added for one run: `node src/pipeline/make-video.ts <script> --blocklist <file>`.

## The frame scan

After the take and the assembly, every picture the video shows is read two ways, and both are checked:

1. **From the picture**, with Windows' own text recognition (part of Windows; nothing to download or licence). The picture
   is enlarged three times first, because a program's text is small for text recognition. It sees everything on screen,
   including images and the program's own dialogs. Several pictures are read at once; a two-minute video takes under a
   minute.
2. **From the page**, where the program's hook can say (`text`, hook version 2): exact, so a misread name is still caught.

Each blocked thing in one place becomes one flag, however many pictures it is in, with every frame it shows on, the steps
it covers, where it is in the picture and how it was found. A flag's id comes from what was found and where, so the same
take gives the same ids, and decisions carry over to a run with the same pictures (the approval of the video never does).

## The review gate

`Review Video.bat` opens the most recent video's review in OpenStage Studio's window (or drag a video's folder onto it).
For each flag the window shows what was found, when and where, and the picture with the place outlined, and a button jumps
the video to that moment. The person types their name once, then decides:

- **Approve: it may show.** For something the scans could not judge, such as an invented name that looks like a real one.
- **Blur it.** Adds a blurred box to the script (`redactions`), over that place for the steps it shows in. Make the video
  again to apply it; the flag then counts as resolved, because the video itself has the box.
- **Record again.** For something that should not be there at all: change the demo project or the script and make the
  video again. Export stays shut meanwhile.

When every flag is resolved, the person approves the video, and export opens. Changing any decision takes the approval
back. The window and the command line apply the same rules, and export also checks that the video file is the very one
that was reviewed. Everything works by keyboard and is said in words as well as symbols.

## The publishing package

`Export Packages.bat` (or the window's Export button) makes one folder per approved video, numbered by playlist position:

| File | What it is |
|---|---|
| `video.mp4` | The video, 1920 by 1080, 30 frames a second. |
| `captions.srt`, `captions.vtt` | The caption track, made from the script, to upload in place of automatic captions. |
| `thumbnail.png` | 1280 by 720, from the product's template: the product's name, the title, and a close view of one step. |
| `upload.txt` | The title, the description (with the chapter list when there are three or more chapters), tags, playlist and position, and how the narration was made. |
| `transcript.txt` | The plain transcript. |
| `video.json` | The same details, for tools. |

`checklist.txt` beside the folders lists what to upload where, video by video, in playlist order. Every package says how
its narration was made; the description's line saying so is off unless a project turns it on (decided 2026-11-14). The
publishing details are taken when the video is made (`publish.json`), so a later edit to the script cannot change what
goes with a video that was already reviewed. Uploading is done by a person through the site's normal upload page.

## The acceptance test

`Check Guard.bat` runs the spec's test for phase 2, on the display `local-settings.json` names:

1. `examples/guard/blocked-name.json` types an invented product name that `examples/guard/test-blocklist.json` blocks. It
   must be stopped at the script scan, with nothing recorded.
2. `examples/guard/planted-path.json` opens a demo project whose notes show an invented file path. The frame scan must
   flag it, and nothing else.
3. Export must stay shut while the flag is open, and an export tried anyway must make nothing.

It never approves anything. The report is in `renders\guard-check\guard-check-report.txt`.
