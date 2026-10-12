//! Diff data sent to the UI (docs/04 › Core data model): files, hunks with stable IDs, lines
//! with intraline emphasis and, in local mode, whether each change is in the index.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FileStatus {
    Added,
    Deleted,
    Renamed,
    Copied,
    Modified,
}

impl FileStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Added => "added",
            Self::Deleted => "deleted",
            Self::Renamed => "renamed",
            Self::Copied => "copied",
            Self::Modified => "modified",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LineKind {
    Ctx,
    Add,
    Del,
}

/// A changed range inside a line, in UTF-16 code units of `text` (what JavaScript indexes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct Emphasis {
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Line {
    pub kind: LineKind,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_no: Option<u32>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_no: Option<u32>,
    /// Text for display: no line end, no `\r`.
    pub text: String,
    pub emphasis: Vec<Emphasis>,
    /// Local changes only: whether this added or deleted line is in the index (F-16.1).
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staged: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Hunk {
    /// Stable ID (F-05.3, F-05.7).
    pub id: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// Function context from the hunk header ("ProcessAsync"), may be empty.
    pub header: String,
    pub lines: Vec<Line>,
    /// The file-level hunk of a change without text hunks (F-05.7); it has no lines.
    pub file_level: bool,
    /// Local changes: the index holds a version of these lines that isn't in the file.
    pub staged_differs: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileDiff {
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_path: Option<String>,
    pub status: FileStatus,
    /// Listed but not rendered (F-05.2).
    pub binary: bool,
    /// "100644 → 100755" when only or also the mode changed.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_change: Option<String>,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<Hunk>,
    /// Single lines can be staged (false for binary files and text that isn't UTF-8).
    pub line_staging: bool,
}

/// Strips the `\r` of a CRLF line for display.
pub fn display_text(raw: &str) -> String {
    raw.strip_suffix('\r').unwrap_or(raw).to_owned()
}
