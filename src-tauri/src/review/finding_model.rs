//! Claude's notes on a step (docs/04 › Core data model, F-09.1): the step task's output after
//! validation (`findings.rs`), fingerprinted for dismissals (`fingerprint.rs`, F-09.4).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Severity {
    /// Likely wrong.
    Fix,
    /// Needs the author's answer.
    Q,
    Nit,
}

/// Which side of the diff a note's line is numbered on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Side {
    Old,
    New,
}

/// The reviewer's decision on a note (F-09.2).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Decision {
    #[default]
    Open,
    Draft,
    Dismissed,
}

/// A `file:line` Claude checked ("Checked in" chips, F-08.6).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Evidence {
    /// Relative to the worktree, forward slashes.
    pub file: String,
    pub line: u32,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Finding {
    /// Derived from the step, the position in the result and the fingerprint, so a cached
    /// result validated again keeps its IDs.
    pub id: String,
    pub step_id: String,
    pub severity: Severity,
    /// Stable kebab-case category; part of the fingerprint.
    pub kind: String,
    pub title: String,
    pub body: String,
    /// The path of the file in the diff (new path, or old path of a deleted file).
    pub file: String,
    pub side: Side,
    pub line: u32,
    pub evidence: Vec<Evidence>,
    pub suggested_comment: String,
    pub fingerprint: String,
    pub decision: Decision,
}

/// A file Claude read for the step (Analysis context, F-08.7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileRead {
    pub file: String,
    pub why: String,
}

/// A mechanical region of the step the reader can skip, as new-side lines.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Fold {
    pub file: String,
    pub new_start: u32,
    pub new_end: u32,
    pub title: String,
    pub reason: String,
}

/// The validated result of the step task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StepAnalysis {
    pub step_id: String,
    /// In diff order: file, then line.
    pub findings: Vec<Finding>,
    /// "For you to judge" (F-08.7).
    pub checklist: Vec<String>,
    pub files_read: Vec<FileRead>,
    pub folds: Vec<Fold>,
}
