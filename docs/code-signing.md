# Code signing and making a release

Written 2026-11-15, following OpenExplainer's policy (Jason chose to sign Studio the same way).

## Code signing policy

Every published release of OpenStage Studio is signed.

## Releases

| Release | Published | Commit | SHA-256 of the setup |
|---|---|---|---|
| [0.1.0 alpha 1](https://github.com/jasonswrench-beep/OpenStage_Studio/releases/tag/v0.1.0-alpha.1) (pre-release) | 2026-11-16 | `fe2033bc0da9ba6b2523da39e7a820d9bc04c088` | `88fc1850ab272b8bed9d6808e3c93609a9db8187011caec1361057819e67f159` |

0.1.0 alpha 1 was checked as step 6 below says: the tag points at the commit, GitHub's SHA-256 of the setup matches, the
release holds exactly two files, and a downloaded copy is signed by Jason Wrench with a timestamp.

- **Who signs.** The setup file and every program in it (Studio itself, the helper, the installer's plugins and the
  uninstaller) are signed by the publisher, **Jason Wrench**, with a code-signing certificate in the publisher's own name
  from a cloud code-signing service. The certificates last three days, so every signature carries
  a timestamp, which keeps it valid after its certificate runs out.
- **What is signed.** Only what a Studio release carries. Files their makers have already signed keep their makers'
  signatures: Node.js (`node\node.exe`, signed by the OpenJS Foundation) and the web view's setup inside the installer.
- **Team roles.** Author, committer, reviewer and approver: the owner, Jason S. Wrench
  ([jasonswrench-beep](https://github.com/jasonswrench-beep)). Most changes are written with an AI coding assistant in
  sessions the owner starts; the owner decides what is committed and what is released.
- **Privacy.** Studio does not send information to other computers unless the person asks: to download the voice or the
  built-in AI model (after pressing Download), and, only if the person chooses a hosted AI service with their own key, to
  that service (`docs/ai.md`). The connector listens only to an assistant this person starts on this computer. The
  installer carries the web view's small setup; on a computer that has no web view yet (Windows 11 always has one), that
  setup downloads it from its maker.

## How a release is made

The repository is public, so a release is seen by everyone. The owner is asked first, every time, and nothing is
published without the owner's yes.

1. Raise `RELEASE` in `tools/build-installer.mjs` to the new version, such as `1.0.1` (and, for a new version, the
   versions `docs/release.md` lists beside it).
2. Run the checks (`Test Everything.bat`, `Check Licences.bat`, `Check Same Video.bat`, and the other acceptance checks),
   then commit everything (as `jasonswrench-beep`, with no Co-Authored-By or "Generated with" lines; `CLAUDE.md`), so the
   working tree is clean. Tag that commit `v<release>` and push the commit and the tag to `main`. The tag comes before
   the build, so it points at the exact commit the build came from.
3. On the owner's computer, from that tagged commit, signed in to the signing service, with the account's details in the environment
   (the top of `tools/sign_windows.py` names them: `OPENSTAGE_SIGN_ENDPOINT`, `OPENSTAGE_SIGN_ACCOUNT`,
   `OPENSTAGE_SIGN_PROFILE`, and optionally `OPENSTAGE_SIGN_PUBLISHER`): `node tools/build-installer.mjs --sign`. It stops
   on any problem: a Node.js that is not the pinned build, a file that names this computer's user folder, an installer
   that would download the web view's setup, a missing file, or a program in the setup that is not signed and timestamped.
   It writes `src-tauri/target/release-files/OpenStage-Studio-<release>-Setup.exe` and its `.sha256.txt`.
4. Run `Test Installed App.bat` on the signed setup.
5. Make the release with exactly those two files, on the tag pushed in step 2, titled "OpenStage Studio X.Y.Z" (an
   alpha or beta is a pre-release, titled "OpenStage Studio X.Y.Z alpha N"), with notes in plain words and no em dashes:
   what changed, who signed it, the SHA-256, what has NOT been tried, and the commit.
6. Check the release: the tag points at the commit, GitHub's own SHA-256 of the setup is the one computed, there are
   exactly two files, it is published (as a pre-release, for an alpha or beta), and a downloaded copy is signed.

`tools/sign_windows.py` is the OpenStage suite's shared signing script, copied unchanged from OpenExplainer. It is release
tooling run on the owner's computer, not part of the app (Studio has no Python in it). A change to it is made in every
tool's copy at once.
