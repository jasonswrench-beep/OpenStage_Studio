# What only Jason can check

Things the build sessions cannot try themselves: a person's eyes and ears, real recordings, a screen reader, a hosted AI
key's cost, and decisions. Newest round first. Tick or delete an item once done.

## The voice on the graphics card, 2026-11-26

- [x] **Listen: CUDA against the processor, and DirectML.** Three course lines, each made three ways, are in
      `C:\Dev\Training Videos\PrismQDA\renders\voice-device-check` (`line-N-processor.wav`, `line-N-cuda.wav`,
      `line-N-directml.wav`; made again on 2026-11-27 from 2b462cd, as the first set was deleted with its note folder).
      Measured, CUDA is the processor's voice and DirectML is duller and hissier (docs/voice-models.md). Do your ears agree?
      **Jason, 2026-11-27:** "I cannot tell the difference between processor and cuda. Directml just BARELY softer."
- [x] **Decide: may the installer carry CUDA?** It needs NVIDIA's CUDA 13 runtime and cuDNN 9 (NVIDIA's licences, about
      1.5 GB), now only in `%LOCALAPPDATA%\openstage-cuda-trial` on this computer. Without them the voice stays on the
      processor, as before.
      **Jason, 2026-11-27: DirectML for installs.** The installer carries no NVIDIA files. An installed Studio uses DirectML
      (Windows' own `DirectML.dll`) when the computer is busy; Jason's own computer keeps CUDA. Built the same day: on a
      busy computer the voice tries CUDA, then DirectML, then the processor (docs/voice-models.md).

## Security fixes of 2026-11-24

The fixes the security review of 2026-11-17 asked for:

- [x] `Check Same Video.bat` (the demo-mode hook and the helper changed; neither should change a frame). Passed on the
      fixes on 2026-11-27, with the new fingerprint the browser engine update gave (docs/release.md).
- [ ] `Test Installed App.bat` on a setup with the fixes (the shell finds its engine and the work folder another way, and
      Studio's own page has a stricter rule for what it may reach).
- [ ] **Your AI key moves to a protected form** the first time this version reads your AI settings. An older Studio, or a
      checkout without the fix, then asks for the key again. Merge the fix everywhere you run Studio first.
- [ ] `Review Video.bat`: open a review and add a blurred box; it should still go straight into the script.

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
`Check Reach.bat` (its hosted AI part). The code they cover changed only slightly (the script format is version 3; AI-written
scripts now say so). Run them when you are happy to spend the credit.

### Installer and release

- [x] **A signed build**, tested and published as the 0.1.0 alpha 1 pre-release (2026-11-16, `docs/code-signing.md`).
- [ ] **Install the published release by hand** from its GitHub page: the download, SmartScreen, the installer's own
      wizard (the test used the silent install), and a first look at the window.
- [ ] The installed-app test leaves its example video and the examples in your work folder (`Documents\OpenStage Studio`). Delete
      them if you like; Studio copies the examples again when needed.

### Decisions waiting on the shared core

See `CORE-REQUESTS.md`: C5 (spoken description, and maybe moving Studio's narration onto it), C1's description track,
"send to", and an automation id in a recording's log.
