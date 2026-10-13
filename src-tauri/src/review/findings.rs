//! Validation of the step task's `structured_output` (F-09.1, 05 › Tasks, models and
//! contracts). Authoritative even though the CLI enforces `step-findings.schema.json`:
//! structural errors, notes or folds on lines outside the step's hunks and evidence that points
//! at no line of a worktree file are `CLAUDE_SCHEMA` (never partial data); too long strings are
//! clamped with "…". Notes are fingerprinted (F-09.4) and dismissed fingerprints are left out.

use std::collections::HashSet;
use std::path::{Component, Path};

use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::finding_model::{
    Decision, Evidence, FileRead, Finding, Fold, Severity, Side, StepAnalysis,
};
use super::fingerprint;
use crate::claude::error::ClaudeError;
use crate::claude::result::clamp;
use crate::git::model::{FileDiff, Hunk};

// maxLength and maxItems of step-findings.schema.json.
const TITLE_MAX: usize = 80;
const BODY_MAX: usize = 600;
const COMMENT_MAX: usize = 600;
const EVIDENCE_NOTE_MAX: usize = 120;
const CHECK_MAX: usize = 140;
const WHY_MAX: usize = 80;
const FOLD_TITLE_MAX: usize = 60;
const FOLD_REASON_MAX: usize = 120;
const FINDINGS_MAX: usize = 8;
const EVIDENCE_MAX: usize = 4;
const CHECKLIST_MAX: usize = 4;
const FILES_READ_MAX: usize = 10;
const FOLDS_MAX: usize = 5;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StepOutput {
    findings: Vec<FindingOutput>,
    checklist: Vec<String>,
    files_read: Vec<FileReadOutput>,
    folds: Vec<FoldOutput>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FindingOutput {
    severity: Severity,
    kind: String,
    title: String,
    body: String,
    file: String,
    side: Side,
    line: u32,
    evidence: Vec<EvidenceOutput>,
    suggested_comment: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EvidenceOutput {
    file: String,
    line: u32,
    note: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FileReadOutput {
    file: String,
    why: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FoldOutput {
    file: String,
    new_start: u32,
    new_end: u32,
    title: String,
    reason: String,
}

/// The files and hunks of one step, in diff order.
pub struct StepScope<'a> {
    pub step_id: &'a str,
    files: Vec<(&'a FileDiff, Vec<&'a Hunk>)>,
}

impl<'a> StepScope<'a> {
    /// The step's hunks among the change's files; unknown IDs are ignored.
    pub fn new(step_id: &'a str, files: &'a [FileDiff], hunk_ids: &[String]) -> Self {
        let ids: HashSet<&str> = hunk_ids.iter().map(String::as_str).collect();
        let files = files
            .iter()
            .filter_map(|f| {
                let hunks: Vec<&Hunk> = f.hunks.iter().filter(|h| ids.contains(&*h.id)).collect();
                (!hunks.is_empty()).then_some((f, hunks))
            })
            .collect();
        Self { step_id, files }
    }

    /// The step's files, each with only the step's hunks (the step diff of the task).
    pub fn files(&self) -> Vec<FileDiff> {
        self.files
            .iter()
            .map(|(f, hunks)| FileDiff {
                hunks: hunks.iter().map(|h| (*h).clone()).collect(),
                ..(*f).clone()
            })
            .collect()
    }

    /// The file a note names (new or old path): its position in the step, path and hunks.
    fn file(&self, name: &str) -> Option<(usize, &'a str, &[&'a Hunk])> {
        self.files.iter().enumerate().find_map(|(i, (f, hunks))| {
            let matches = [&f.new_path, &f.old_path]
                .into_iter()
                .any(|p| p.as_deref() == Some(name));
            matches.then(|| (i, path(f), hunks.as_slice()))
        })
    }
}

fn path(file: &FileDiff) -> &str {
    file.new_path
        .as_deref()
        .or(file.old_path.as_deref())
        .unwrap_or_default()
}

fn schema(detail: &str) -> ClaudeError {
    ClaudeError::Schema(detail.to_owned())
}

fn is_kind(kind: &str) -> bool {
    (3..=48).contains(&kind.len())
        && kind
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// `path` relative to `root`, with forward slashes; `None` for paths that leave it.
pub fn relative(root: &Path, path: &str) -> Option<String> {
    let given = Path::new(path);
    let rel = if given.is_absolute() {
        given.strip_prefix(root).ok()?
    } else {
        given
    };
    let mut parts = Vec::new();
    for component in rel.components() {
        match component {
            Component::Normal(part) => parts.extend(
                part.to_str()?
                    .split(['/', '\\'])
                    .filter(|p| !p.is_empty())
                    .map(str::to_owned),
            ),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!parts.is_empty() && !parts.iter().any(|p| p == "..")).then(|| parts.join("/"))
}

/// The number of lines of a file in the worktree, `None` when it isn't a file there.
pub fn worktree_lines(root: &Path) -> impl Fn(&str) -> Option<usize> + '_ {
    move |rel| {
        let full = rel
            .split('/')
            .fold(root.to_path_buf(), |p, part| p.join(part));
        let bytes = std::fs::read(full).ok()?;
        let lines = bytes.split(|b| *b == b'\n').count();
        Some(if bytes.ends_with(b"\n") || bytes.is_empty() {
            lines - 1
        } else {
            lines
        })
    }
}

/// The validated analysis of a step. `relative_path` maps a cited path to the worktree (or
/// `None`); `line_count` gives the lines of a worktree file (see [`worktree_lines`]). Notes
/// whose fingerprint is in `dismissed` are left out. Details never quote Claude's text.
pub fn validate(
    output: Option<&Value>,
    scope: &StepScope<'_>,
    dismissed: &HashSet<String>,
    relative_path: impl Fn(&str) -> Option<String>,
    line_count: impl Fn(&str) -> Option<usize>,
) -> Result<StepAnalysis, ClaudeError> {
    let value = output.ok_or_else(|| schema("no structured output"))?;
    let out = StepOutput::deserialize(value)
        .map_err(|_| schema("structured output doesn't match step-findings.schema.json"))?;
    if out.findings.len() > FINDINGS_MAX
        || out.checklist.len() > CHECKLIST_MAX
        || out.files_read.len() > FILES_READ_MAX
        || out.folds.len() > FOLDS_MAX
    {
        return Err(schema("too many findings, checks, files or folds"));
    }

    let mut findings = Vec::new();
    for (index, f) in out.findings.iter().enumerate() {
        if !is_kind(&f.kind) || f.evidence.is_empty() || f.evidence.len() > EVIDENCE_MAX {
            return Err(schema("invalid kind or evidence count"));
        }
        let (position, file, hunks) = scope
            .file(&f.file)
            .ok_or_else(|| schema("a finding on a file outside the step"))?;
        let fingerprint = hunks
            .iter()
            .find_map(|h| fingerprint::for_hunk_line(&f.kind, file, h, f.side, f.line))
            .ok_or_else(|| schema("a finding on a line outside the step"))?;
        let mut evidence = Vec::new();
        for e in &f.evidence {
            // The finding's own line counts (prompt rule); on the old side it isn't in the worktree.
            let own = e.line == f.line && scope.file(&e.file).is_some_and(|(p, ..)| p == position);
            let cited = if own {
                Some(file.to_owned())
            } else {
                relative_path(&e.file).filter(|rel| {
                    line_count(rel).is_some_and(|n| (1..=n).contains(&(e.line as usize)))
                })
            };
            let cited =
                cited.ok_or_else(|| schema("evidence cites a line that isn't in the worktree"))?;
            evidence.push(Evidence {
                file: cited,
                line: e.line,
                note: clamp(&e.note, EVIDENCE_NOTE_MAX),
            });
        }
        findings.push((
            (position, f.line),
            Finding {
                id: finding_id(scope.step_id, index, &fingerprint),
                step_id: scope.step_id.to_owned(),
                severity: f.severity,
                kind: f.kind.clone(),
                title: clamp(&f.title, TITLE_MAX),
                body: clamp(&f.body, BODY_MAX),
                file: file.to_owned(),
                side: f.side,
                line: f.line,
                evidence,
                suggested_comment: clamp(&f.suggested_comment, COMMENT_MAX),
                fingerprint,
                decision: Decision::Open,
            },
        ));
    }
    findings.sort_by_key(|(order, _)| *order);

    let mut folds = Vec::new();
    for fold in &out.folds {
        let (_, file, hunks) = scope
            .file(&fold.file)
            .ok_or_else(|| schema("a fold on a file outside the step"))?;
        let inside = |h: &&Hunk| {
            h.new_lines > 0
                && h.new_start <= fold.new_start
                && fold.new_start <= fold.new_end
                && fold.new_end < h.new_start + h.new_lines
        };
        if !hunks.iter().any(inside) {
            return Err(schema("a fold on lines outside the step"));
        }
        folds.push(Fold {
            file: file.to_owned(),
            new_start: fold.new_start,
            new_end: fold.new_end,
            title: clamp(&fold.title, FOLD_TITLE_MAX),
            reason: clamp(&fold.reason, FOLD_REASON_MAX),
        });
    }

    Ok(StepAnalysis {
        step_id: scope.step_id.to_owned(),
        findings: findings
            .into_iter()
            .map(|(_, f)| f)
            .filter(|f| !dismissed.contains(&f.fingerprint))
            .collect(),
        checklist: out.checklist.iter().map(|c| clamp(c, CHECK_MAX)).collect(),
        files_read: out
            .files_read
            .iter()
            .map(|r| FileRead {
                file: relative_path(&r.file).unwrap_or_else(|| r.file.clone()),
                why: clamp(&r.why, WHY_MAX),
            })
            .collect(),
        folds,
    })
}

/// A UUID (version 8) over step, position and fingerprint: stable across validations.
fn finding_id(step_id: &str, index: usize, fingerprint: &str) -> String {
    let digest = Sha256::digest(format!("{step_id}\0{index}\0{fingerprint}").as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    uuid::Builder::from_custom_bytes(bytes)
        .into_uuid()
        .to_string()
}

#[cfg(test)]
#[path = "findings_tests.rs"]
mod tests;
