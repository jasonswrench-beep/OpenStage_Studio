# What only Jason can check

Things the build sessions cannot try themselves: a person's eyes and ears, real recordings, a screen reader, a hosted AI
key's cost, and decisions. Newest round first. Tick or delete an item once done.

## Development list round of 2026-11-15/16

### Watch and listen

- [ ] **A video made from a recording.** `Check Recording.bat` leaves two in `renders\plan-a-lesson-from-a-recording-repeat`.
      Is the plain narration ("In the Subject list, choose Science.") acceptable as a first draft, or should the draft
      say more?
- [ ] **A lecture video.** `Check Lecture.bat` leaves two in `renders\lecture-check`. Are the slides readable at 1080p,
      and is their look (light background, the accent colour for the bar and bullets) right for your courses? A project
      setting for the slides' colours can be added.
- [ ] **The description track.** Load a video's `descriptions.vtt` as a descriptions track in a player or a video site
      that offers one, and judge whether it says what a viewer who cannot see the screen needs.

### Try with real things

- [ ] **A real recording.** Record Practice Planner with OpenStage Recorder (or Author's recorder) with the interaction log
      on (`record --interactions on`), then drag the `.capture` folder onto `Script From Recording.bat`. The example
      recording is written by hand; a real one may name controls differently (a drop-down list's choices especially).
- [ ] **A lecture from your own notes**, by hand (`Write Lecture.bat` with no AI chosen) and with your AI. The AI path has
      been checked only with tests, not with a real model.

### Accessibility

- [ ] **A screen reader on the new pages**: From a recording and Lecture (and the earlier ones). The automatic checks prove
      every control has a name and every page opens by its name, not how they sound.
- [ ] **Spoken description (WCAG 2.1 1.2.5, level AA).** Until the shared speech engine (C5) is in the core, the
      description is text only. Studio's narration already describes each step's action, and the transcript carries the
      descriptions (1.2.3, level A). Decide whether that is enough for your 2027 date for tutorial videos, or whether
      lectures with pictures need spoken description sooner (`CORE-REQUESTS.md`, S1).

### Checks that spend your hosted AI key

Not run this round, because they call the AI chosen in Set Up AI with your key: `Check AI Scripts.bat`, `Check Batch.bat`,
`Check Reach.bat` (its Claude part). The code they cover changed only slightly (the script format is version 3; AI-written
scripts now say so). Run them when you are happy to spend the credit.

### Installer and release

- [ ] **A signed build** on your computer: `node tools/build-installer.mjs --sign`, then `Test Installed App.bat`
      (`docs/code-signing.md`). Publishing a pre-release stays your call.
- [ ] The installed-app test leaves its example video and the examples in `OneDrive\Documents\OpenStage Studio`. Delete
      them if you like; Studio copies the examples again when needed.

### Decisions waiting on the shared core

See `CORE-REQUESTS.md`: C5 (spoken description, and maybe moving Studio's narration onto it), C1's description track,
"send to", and an automation id in a recording's log.
