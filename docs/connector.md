# The connector: letting an assistant use Studio (phase 5)

The connector is an MCP server (the Model Context Protocol, the way an AI assistant uses a program's tools). With it on,
an assistant a person already uses can read a manual and a program's real controls, write tutorial scripts into a
project folder, rehearse them, and read the results. It cannot record, approve or export a video. The code is in
`src/connector/`.

## Turning it on

The connector is **off** until a person turns it on with `Set Up Connector.bat`, which asks:

- whether it is on, and
- **the one folder an assistant may use** (made if it does not exist). An assistant reads manuals and writes scripts
  there and nowhere else; a name with a path in it, or one that leads out of the folder through a link, is refused.

It then shows the lines to connect an assistant: a block for an assistant that reads its servers from a settings file,
and the command and argument for one that asks for them. The settings are kept in
`%APPDATA%\org.openstage.studio\connector.json` and read again at every request, so turning the connector off takes
effect at once. If it is off, an assistant is refused at its first message with words saying how to turn it on.

Decided with Jason on 2026-11-15: the same pattern as the documentation tool's connector.

## How it runs

`node src/connector/server.ts` speaks on standard input and output, one JSON message per line (`initialize`, `ping`,
`tools/list`, `tools/call`); nothing else is written to standard output. Tool calls run one at a time. Programs it opens
(to read controls or to rehearse) run on the take screen `local-settings.json` names, and are closed afterward.

## The tools

Every tool checks everything first, so a call that cannot be done says why and changes nothing.

| Tool | What it does |
|---|---|
| `list_programs` | The programs Studio can drive: id, drivers (hook, accessibility), demo projects, numbered controls and notes. |
| `list_controls` | Opens a program with a demo project and lists its real controls (stable name, words, role, shown at the start). |
| `list_files` | The manuals and scripts in the connector's folder. |
| `read_manual` | A manual's chapters, or one chapter's words and numbered steps. |
| `read_script` | A script in the folder. |
| `check_script` | Every problem with a script, without writing it: the format, the program's real controls and demo projects, and the scan for blocked names. |
| `write_script` | Writes a script into the folder, only if it passes every check; sets `writtenBy` to the assistant unless the script says otherwise. A `.repaired.json` name is refused. |
| `rehearse_script` | Performs a script in its program with nothing recorded: passed, or the first step that could not be performed and why, with the controls (and, through the hook, the text) on screen at that moment. |

## The acceptance test

`Check Reach.bat` runs the spec's test for phase 5 (both parts):

1. Practice Planner, with its hook off, records a whole video through the accessibility driver
   (`docs/accessibility-driver.md`).
2. The first hosted AI service, with the key `Set Up AI.bat` saved, acts as the outside assistant: given only the connector's tools, over the
   connector's own protocol, it is asked to write a script for "Making a new lesson" from the invented manual and to
   rehearse it until it passes. Studio then rehearses the script itself, independently. The connector runs with its own
   settings in `renders\reach-check\`, so a person's own connector settings are not touched.
