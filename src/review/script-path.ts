// Whether a path named in a review's file is a full path on a drive of this computer. A review folder can come from someone
// else, and only looking at a network path makes Windows sign in to that computer, so anything else is never opened: the
// person is asked to choose the script instead. (The shell checks the same, src-tauri/src/review_scope.rs.)

export function onADrive(path: unknown): path is string {
  return typeof path === "string" && /^[A-Za-z]:[\\/][^:]+$/.test(path);
}
