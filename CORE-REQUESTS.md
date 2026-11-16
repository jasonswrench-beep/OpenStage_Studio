# Requests to the OpenStage shared core

What OpenStage Studio needs from the shared core (`jasonswrench-beep/openstage-core`) that the core does not offer yet.
Studio builds none of these itself; it waits for the core and then builds on what is published. Read with the core's
`CORE-NOTES.md`. Started 2026-11-15, Studio's development list round of that date.

## What Studio uses from the core today

- **C1, the capture format, tag `capture-v0.1.0`**: the window capture, the MP4 writer, the frame canvas and Windows' text
  drawing (`openstage-capture-windows`, `-render`), and the recording reader (`openstage-capture-project`: `open_project`,
  `list_takes`, `read_take_log`), through `studio-helper`. Studio's own copy of this code (from OpenStage Author commit
  3c47a83, identical apart from two reworded comments) was removed on 2026-11-15.

## Requests

### S1. C5, the speech engine, with text to speech on this computer (Studio list item 2)

Studio's development list asks for an audio description track "through C5". C5 is still inside OpenStage Author (the
core's ROADMAP, "OpenStage Recorder: captions, Send to and audio description"). Until it is in the core, Studio writes the
description text only (in the script, a WebVTT description file and the transcript) and speaks none of it.

What Studio needs from C5:

1. **Text to speech on this computer**, callable from a Rust program (Studio's helper) or as a small program with a JSON
   interface: given text, a voice and a rate, a WAV file and its exact length. The same input must give the same sound,
   byte for byte, because Studio's videos must be the same every time they are made (its repeat check compares the sound
   given to the encoder).
2. **One shared install of the voice models** per computer, downloaded on request and checked against pinned SHA-256s,
   never bundled; and a way for a tool to ask whether a voice is installed.
3. **The voices' licences audited by the core** (Studio's rule: open model weights are audited one by one).
4. Studio already narrates with Kokoro-82M (ONNX Runtime and misaki-rs without espeak, `tools/kokoro-model.json`). If C5
   uses the same model, Studio can move its narration to C5 too, and the two would share one download. Studio would
   rather do that than keep a second speech path: say whether C5 will carry Kokoro.

### S2. C1: what an audio description track holds (Studio list item 2)

`capture.json` has `tracks.audioDescription`, empty in 0.2.5, with its contents "defined in later versions". Studio
writes descriptions per step today in its own files. When C1 defines the track, Studio will write a recording's
description track in that form wherever it writes into a capture project (it does not today; it only reads them). Please
also define:

- whether a description is spoken into the video's own sound (pausing it, extended description) or into a second sound
  file, and how a player chooses;
- the WebVTT form (`kind="descriptions"`) the video maker writes beside the MP4, so Studio, the Recorder and Author write
  the same file.

### S3. C1: the "send to" path, for Studio (Studio list item 1)

The core's ROADMAP lists "send to": one recording opened in OpenExplainer, OpenStage Studio or OpenStage Author without
exporting it by hand. Studio reads a recording folder today ("From a recording", `src/recording/import.ts`) when a person
chooses it. When the core defines how a recorder hands a recording to another tool (a command line, a file association,
or a small hand-off file), Studio will accept it. Studio needs only the recording folder's path and, if known, the take.

### S4. C1: a stable control id in the interaction log (Studio list item 1, nice to have)

A recording's `element` line holds a clicked control's name and role, not its automation id. Studio finds each control
again by name and role, in the program itself, and then uses the program's stable ids. An automation id in the `element`
line, when Windows gives one, would make that more reliable for programs whose names change with the language or the
content (a list item named after a document). Optional, a minor version.

### S5. C1: a caption track's contents (Studio list item 2, later)

Studio makes captions from the script, not from speech. When C1 defines `tracks.captions`, Studio will be able to hand a
recording-based video's captions back to the capture project. Nothing is needed for Studio's own videos.
