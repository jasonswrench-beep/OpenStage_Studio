// SPDX-License-Identifier: Apache-2.0
//! `recording --project <folder>`: read a recording made by an OpenStage recorder (the shared capture format, C1: a
//! `something.capture` folder) and say what is in it, as one JSON line: its title and language, and for every take its
//! state, length and what its interaction log holds (the windows in front, the clicks with the names and roles of what
//! was clicked, the keys, the author's markers).
//!
//! Everything is read with the shared core's own code (`openstage-capture-project`): the manifest is checked as the
//! recorders check it, and a log line cut short by a crash is skipped as the format says. Studio turns the result into a
//! draft tutorial script (src/recording/to-script.ts). Nothing in the recording is changed. The log can hold private
//! things (window titles, what was clicked, what was typed); none of it leaves this computer.

use crate::{arg, say};
use openstage_capture_project::{list_takes, open_project, read_take_log, TakeState};
use serde_json::json;
use std::path::PathBuf;

pub fn run(args: &[String]) -> Result<(), String> {
    let project = PathBuf::from(arg(args, "--project").ok_or("Say which recording to read: --project <folder>.")?);
    say(read(&project)?);
    Ok(())
}

/// The recording as JSON (see the module's description).
pub fn read(project: &std::path::Path) -> Result<serde_json::Value, String> {
    let manifest = open_project(project).map_err(|e| format!("{} could not be opened as a recording: {e}", project.display()))?;
    let mut takes = Vec::new();
    for entry in list_takes(project).map_err(|e| e.to_string())? {
        let Some(take) = entry.take else {
            takes.push(json!({ "id": entry.id, "readable": false }));
            continue;
        };
        let interactions = take.media.iter().find(|m| m.kind == "interactions").and_then(|m| m.interactions.clone());
        let lines = read_take_log(project, entry.id).map_err(|e| format!("Take {} could not be read: {e}", entry.id))?;
        let state = match take.state {
            TakeState::Recording => "recording",
            TakeState::Complete => "complete",
            TakeState::Recovered => "recovered",
            TakeState::SetAside => "setAside",
        };
        takes.push(json!({
            "id": entry.id,
            "readable": true,
            "state": state,
            "durationMs": take.duration_ms,
            "interactions": interactions.map(|i| json!({ "display": i.display, "keys": i.keys })),
            "lines": lines,
        }));
    }
    Ok(json!({
        "event": "recording",
        "title": manifest.title,
        "language": manifest.language,
        "schemaVersion": manifest.schema_version,
        "takes": takes,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../examples/recordings/plan-a-lesson.capture")
    }

    #[test]
    fn reads_the_example_recording_with_the_cores_code() {
        let r = read(&example()).expect("the example recording opens");
        assert_eq!(r["title"], "Plan a lesson");
        let take = &r["takes"][0];
        assert_eq!(take["state"], "complete");
        assert_eq!(take["interactions"]["keys"], true);
        let lines = take["lines"].as_array().unwrap();
        assert!(lines.iter().any(|l| l["type"] == "element" && l["name"] == "New lesson" && l["role"] == "button"));
        // The last line of the example was cut short on purpose, as a crash leaves it; it is skipped, not an error.
        assert!(lines.iter().all(|l| l["type"].is_string()));
    }

    #[test]
    fn a_folder_that_is_not_a_recording_is_refused_in_words() {
        let err = read(&example().join("takes")).unwrap_err();
        assert!(err.contains("could not be opened as a recording"), "{err}");
    }
}
