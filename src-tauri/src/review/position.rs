//! Positions in the diff: a draft's line (`Draft.position`, docs/04) and the lines the reviewer
//! selected for a question (F-10.1) or a draft from an answer (F-10.3).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::finding_model::Side;
use crate::git::model::{FileDiff, Line, LineKind};

/// One line of the diff, numbered on `side`; GitLab's position is built from it at publish.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiffPosition {
    /// The path of the file in the diff (new path, or old path of a deleted file).
    pub file: String,
    pub side: Side,
    pub line: u32,
}

/// The number of a diff line on `side`: an added line has none on the old side, a deleted
/// line none on the new side.
fn number_on(line: &Line, side: Side) -> Option<u32> {
    match side {
        Side::New if line.kind != LineKind::Del => line.new_no,
        Side::Old if line.kind != LineKind::Add => line.old_no,
        _ => None,
    }
}

impl DiffPosition {
    /// Whether `line` is this position's line (its file aside).
    pub fn is_on(&self, line: &Line) -> bool {
        number_on(line, self.side) == Some(self.line)
    }
}

/// Lines `start..=end` of one file, numbered on `side`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LineSelection {
    pub file: String,
    pub side: Side,
    pub start: u32,
    pub end: u32,
}

impl LineSelection {
    /// A draft from the selection sits on its last line (GitLab comments on one line).
    pub fn position(&self) -> DiffPosition {
        DiffPosition {
            file: self.file.clone(),
            side: self.side,
            line: self.end.max(self.start),
        }
    }

    /// The diff lines of the selection in `files`, in diff order; empty when the file isn't
    /// there or no line of it is in the range.
    pub fn lines<'a>(&self, files: &'a [FileDiff]) -> Vec<&'a Line> {
        let (low, high) = (self.start.min(self.end), self.start.max(self.end));
        files
            .iter()
            .filter(|f| {
                [&f.new_path, &f.old_path]
                    .into_iter()
                    .flatten()
                    .any(|p| *p == self.file)
            })
            .flat_map(|f| f.hunks.iter().flat_map(|h| h.lines.iter()))
            .filter(|l| number_on(l, self.side).is_some_and(|n| (low..=high).contains(&n)))
            .collect()
    }
}
