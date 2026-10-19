//! The MR has a newer version than the reviewed one (F-12.5, M5 decision 10b): Publish moves each
//! ticked line comment to that version. Its line is found there with [`LineMap`] (a new-side line
//! from the reviewed head to the latest head, a removed line from the reviewed base to the latest
//! base), and GitLab's position is read from the latest version's diff, so the comment lands on
//! the same text. A draft whose line is gone (no match, or its file is no longer in the MR) is
//! outdated: unticked, not sent, and the user may tick it to send it as a general comment with
//! `file:line` quoted ([`quoted`]).
//!
//! When the versions can't be read (a commit that can't be fetched, git failing), there is no
//! re-map: `None`, and Publish anchors the comments to the reviewed version as before, which
//! GitLab shows as comments on an older version. Nothing here asks GitLab.

use std::collections::HashMap;

use super::drafts::Draft;
use super::line_map::LineMap;
use super::note_position::note_position;
use super::position::DiffPosition;
use super::source_files;
use crate::git::Git;
use crate::git::model::FileDiff;
use crate::gitlab::draft_notes::{DiffRefs, NotePosition};
use crate::os::process::Cancel;
use crate::review::finding_model::Side;
use crate::source::model::Source;

/// The session's repository and source: where the versions of the MR are read.
pub struct Repo {
    pub git: Git,
    pub source: Source,
}

/// The positions on the latest version, per draft id.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Moved {
    pub positions: HashMap<String, NotePosition>,
}

/// What the re-map found for the asked drafts.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Remapped {
    pub moved: Moved,
    /// The drafts whose line is gone from the latest version, in the order asked.
    pub outdated: Vec<String>,
}

/// The text of an outdated draft sent as a general comment: its `file:line` quoted, then its body.
pub fn quoted(draft: &Draft) -> String {
    match &draft.position {
        Some(at) => format!("`{}:{}`\n\n{}", at.file, at.line, draft.body),
        None => draft.body.clone(),
    }
}

/// Moves the line comments among `ids` from the reviewed version (`files`, `reviewed`) to the
/// latest one (see the module docs). Drafts without a line, published or outdated already are
/// left alone. `None` when the versions can't be read.
pub async fn remap(
    repo: &Repo,
    drafts: &[Draft],
    ids: &[String],
    files: &[FileDiff],
    reviewed: &DiffRefs,
    latest: &DiffRefs,
    cancel: &Cancel,
) -> Option<Remapped> {
    let mut map = LineMap::new(&repo.git, cancel);
    for sha in [
        &reviewed.base_sha,
        &reviewed.head_sha,
        &latest.base_sha,
        &latest.head_sha,
    ] {
        if !map.readable(sha).await {
            tracing::warn!("a version of the MR can't be read; comments stay on the reviewed one");
            return None;
        }
    }
    let mut out = Remapped::default();
    // (draft id, its line on the latest version)
    let mut found: Vec<(&str, DiffPosition)> = Vec::new();
    for id in ids {
        let Some(draft) = drafts.iter().find(|d| &d.id == id) else {
            continue;
        };
        let Some(at) = &draft.position else { continue };
        if draft.outdated || draft.published_note_id.is_some() {
            continue;
        }
        let line = match note_position(files, at) {
            Some(pos) => match at.side {
                Side::New => {
                    map.line(&reviewed.head_sha, &latest.head_sha, &pos.new_path, at.line)
                        .await
                }
                Side::Old => {
                    map.line(&reviewed.base_sha, &latest.base_sha, &pos.old_path, at.line)
                        .await
                }
            },
            None => None,
        };
        match line {
            Some(line) => found.push((
                id.as_str(),
                DiffPosition {
                    file: at.file.clone(),
                    side: at.side,
                    line,
                },
            )),
            None => out.outdated.push(id.clone()),
        }
    }
    if found.is_empty() {
        return Some(out);
    }
    let latest_files = match source_files::files(
        &repo.git,
        &repo.source,
        &latest.base_sha,
        &latest.head_sha,
        cancel,
    )
    .await
    {
        Ok(files) => files,
        Err(error) => {
            tracing::warn!(%error, "the latest version's diff can't be read");
            return None;
        }
    };
    for (id, at) in found {
        match note_position(&latest_files, &at) {
            Some(position) => {
                out.moved.positions.insert(id.to_owned(), position);
            }
            // The file is no longer in the MR.
            None => out.outdated.push(id.to_owned()),
        }
    }
    out.outdated
        .sort_by_key(|o| ids.iter().position(|id| id == o));
    Some(out)
}
