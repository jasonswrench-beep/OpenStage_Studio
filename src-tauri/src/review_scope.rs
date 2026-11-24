// Which script a review may have the window change. A review folder can come from someone else, so the path in its
// review.json is only a wish: the script must be a tutorial script file on this computer, in the person's work folder or
// beside the review's own folder. Otherwise nothing is opened to the window, and the page asks the person to choose the
// script when one is needed. A network path is refused before Windows is asked anything about it, because only looking at
// one makes Windows sign in to that computer.

use std::path::{Path, PathBuf};

/// Whether a path, as written, is a full path on a drive of this computer (C:\...), and not a network or device path.
pub fn on_a_drive(path: &str) -> bool {
    let b = path.as_bytes();
    b.len() > 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') && !path[2..].contains(':')
}

/// A path's real place, written plainly, or None if it is not there or is really on the network (a mapped drive or a link).
fn real(path: &Path) -> Option<PathBuf> {
    let full = std::fs::canonicalize(path).ok()?;
    let text = full.to_string_lossy();
    let plain = text.strip_prefix(r"\\?\").unwrap_or(&text);
    on_a_drive(plain).then(|| PathBuf::from(plain))
}

/// The script the window may change for the review in `folder`, or None if the person must choose it.
pub fn review_script(script: &str, folder: &Path, workspace: Option<&Path>) -> Option<PathBuf> {
    if !on_a_drive(script) || !script.to_ascii_lowercase().ends_with(".json") {
        return None;
    }
    let file = real(Path::new(script)).filter(|f| f.is_file())?;
    // Never a whole drive: a review folder at the top of one would otherwise open everything on it.
    let inside = |place: Option<PathBuf>| place.is_some_and(|p| p.parent().is_some() && file.starts_with(&p));
    let beside = real(folder).and_then(|f| f.parent().map(Path::to_path_buf));
    (inside(workspace.and_then(real)) || inside(beside)).then_some(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let top = std::env::temp_dir().join(format!("studio-review-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&top);
        for f in ["work/scripts", "received/video", "elsewhere"] {
            std::fs::create_dir_all(top.join(f)).unwrap();
        }
        for f in ["work/scripts/a.json", "received/b.json", "elsewhere/c.json", "work/notes.txt"] {
            std::fs::write(top.join(f), "{}").unwrap();
        }
        top
    }

    fn text(p: PathBuf) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn a_network_or_device_path_is_refused_as_written() {
        for p in [r"\\host\share\x.json", "//host/share/x.json", r"\/host\share\x.json", r"\\?\UNC\host\share\x.json", r"\\.\C:\x.json", r"\\?\C:\x.json", "file://host/share/x.json", "file:///C:/x.json", "x.json", r"C:x.json", r"\x.json", r"C:\a.txt:x.json", ""] {
            assert!(!on_a_drive(p), "{p}");
            assert_eq!(review_script(p, Path::new(r"C:\reviews\one"), Some(Path::new(r"C:\work"))), None, "{p}");
        }
        assert!(on_a_drive(r"C:\work\x.json"));
        assert!(on_a_drive("d:/work/x.json"));
    }

    #[cfg(windows)]
    #[test]
    fn only_a_script_in_the_work_folder_or_beside_the_review_is_opened() {
        let top = scratch("places");
        let (work, folder) = (top.join("work"), top.join("received").join("video"));
        let ask = |p: &str| review_script(&text(top.join(p)), &folder, Some(&work));
        assert!(ask("work/scripts/a.json").is_some());
        assert!(ask("received/b.json").is_some());
        assert_eq!(ask("elsewhere/c.json"), None);
        // The real place decides, not how the path is written.
        assert_eq!(ask("work/../elsewhere/c.json"), None);
        assert_eq!(ask("work/notes.txt"), None);
        assert_eq!(ask("work/not-there.json"), None);
        assert_eq!(review_script(&text(top.join("work/scripts/a.json")), &folder, None), None);
        let _ = std::fs::remove_dir_all(&top);
    }

    #[cfg(windows)]
    #[test]
    fn a_whole_drive_is_never_opened() {
        let top = scratch("drive");
        let file = text(top.join("elsewhere").join("c.json"));
        let drive = PathBuf::from(&file[..3]);
        assert_eq!(review_script(&file, &top.join("received").join("video"), Some(&drive)), None);
        let _ = std::fs::remove_dir_all(&top);
    }
}
