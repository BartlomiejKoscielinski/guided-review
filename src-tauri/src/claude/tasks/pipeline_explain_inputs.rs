//! Explain failure's inputs and the check of its answer (F-20.7, M6 decisions 12 and 14, docs/05 ›
//! Tasks). The log file keeps the log's end within 200 KB; the diff file its start within
//! [`DIFF_MAX`]; the pipelines file lists each pipeline's number, version, status and the same
//! job's status. The answer passes only when `fixed_in_version` (for `already_fixed`) is later
//! than the failing pipeline's version and not above the latest, every `file:line` exists in the
//! worktree (a path, or a file name unique among the MR's files) and every `pipeline #N` is one of
//! the MR's pipelines; anything else is `CLAUDE_SCHEMA`.

use std::path::{Component, Path};

use serde_json::Value;

use super::pipeline_explain::{ExplainRequest, PipelineExplanation, PipelinePoint, Verdict};
use crate::claude::error::ClaudeError;
use crate::claude::result::clamp;

/// Bytes of the log file (plan M6: 200 KB); the start is cut.
pub const LOG_MAX: usize = 200 * 1024;
/// Bytes of the diff file; the end is cut.
pub const DIFF_MAX: usize = 300 * 1024;
/// The schema's `maxLength`s.
const TITLE_MAX: usize = 120;
const EXPLANATION_MAX: usize = 600;
const COMMENT_MAX: usize = 500;
const EVIDENCE_MAX: usize = 4;

fn schema(detail: impl Into<String>) -> ClaudeError {
    ClaudeError::Schema(detail.into())
}

/// The last at most `max` bytes of `text`, on a character boundary.
fn tail(text: &str, max: usize) -> &str {
    let mut start = text.len().saturating_sub(max);
    while !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}

/// The first at most `max` bytes of `text`, on a character boundary.
fn head(text: &str, max: usize) -> &str {
    let mut end = max.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// The log file: the log's end within [`LOG_MAX`], with a note when its start was cut.
pub fn log_file(log: &str) -> String {
    let kept = tail(log, LOG_MAX);
    if kept.len() == log.len() {
        return log.to_owned();
    }
    format!(
        "… ({} earlier bytes of the log left out: size cap)\n{kept}",
        log.len() - kept.len()
    )
}

/// The diff file: the diff's start within [`DIFF_MAX`], with a note when its end was cut.
pub fn diff_file(diff: &str) -> String {
    let kept = head(diff, DIFF_MAX);
    if kept.len() == diff.len() {
        return diff.to_owned();
    }
    format!(
        "{kept}\n… ({} more bytes of the diff left out: size cap)",
        diff.len() - kept.len()
    )
}

/// "3", or "unknown" for 0.
pub fn version_text(version: u32) -> String {
    if version == 0 {
        "unknown".to_owned()
    } else {
        version.to_string()
    }
}

/// The version of pipeline `number`; 0 when it is not listed or has none.
pub fn version_of(pipelines: &[PipelinePoint], number: i64) -> u32 {
    pipelines
        .iter()
        .find(|p| p.number == number)
        .map_or(0, |p| p.version)
}

/// The pipelines file: one line per pipeline, newest first.
pub fn pipelines_file(pipelines: &[PipelinePoint]) -> String {
    pipelines
        .iter()
        .map(|p| {
            format!(
                "pipeline #{} · version {} · {} · this job: {}\n",
                p.number,
                version_text(p.version),
                p.status,
                p.job_status
            )
        })
        .collect()
}

fn verdict_of(text: &str) -> Option<Verdict> {
    Some(match text {
        "caused_by_mr" => Verdict::CausedByMr,
        "already_fixed" => Verdict::AlreadyFixed,
        "unrelated" => Verdict::Unrelated,
        "flaky" => Verdict::Flaky,
        "unknown" => Verdict::Unknown,
        _ => return None,
    })
}

/// The number of lines of the file at `path`; `None` when it can't be read.
fn line_count(path: &Path) -> Option<usize> {
    let bytes = std::fs::read(path).ok()?;
    let newlines = bytes.iter().filter(|b| **b == b'\n').count();
    Some(newlines + usize::from(bytes.last().is_some_and(|b| *b != b'\n')))
}

/// A relative path inside the worktree (no root, no `..`).
fn inside(path: &Path) -> bool {
    path.components().all(|c| matches!(c, Component::Normal(_)))
}

/// The worktree file `file` names: the path itself, or the one MR file with that name.
fn evidence_file(file: &str, req: &ExplainRequest<'_>) -> Option<std::path::PathBuf> {
    let normal = file.replace('\\', "/");
    let relative = Path::new(&normal);
    if normal.is_empty() || !inside(relative) {
        return None;
    }
    let direct = req.cwd.join(relative);
    if direct.is_file() {
        return Some(direct);
    }
    if normal.contains('/') {
        return None;
    }
    let mut named = req.files.iter().filter(|f| {
        f.replace('\\', "/")
            .rsplit('/')
            .next()
            .is_some_and(|name| name == normal)
    });
    match (named.next(), named.next()) {
        (Some(only), None) => Some(req.cwd.join(only.replace('\\', "/"))),
        _ => None,
    }
}

/// `file:line` (or `file:start-end`) whose file and lines exist in the worktree.
fn file_line_exists(item: &str, req: &ExplainRequest<'_>) -> bool {
    let Some((file, lines)) = item.rsplit_once(':') else {
        return false;
    };
    let (start, end) = lines.split_once('-').unwrap_or((lines, lines));
    let (Ok(start), Ok(end)) = (start.trim().parse::<usize>(), end.trim().parse::<usize>()) else {
        return false;
    };
    if start == 0 || end < start {
        return false;
    }
    evidence_file(file.trim(), req)
        .and_then(|path| line_count(&path))
        .is_some_and(|count| end <= count)
}

/// One evidence item, checked: `pipeline #N` of the MR, or an existing `file:line`.
fn check_evidence(item: &str, req: &ExplainRequest<'_>) -> Result<String, ClaudeError> {
    let item = item.trim();
    let lower = item.to_ascii_lowercase();
    if let Some(number) = lower.strip_prefix("pipeline #") {
        let known = number
            .trim()
            .parse::<i64>()
            .ok()
            .is_some_and(|n| req.pipelines.iter().any(|p| p.number == n));
        return if known {
            Ok(item.to_owned())
        } else {
            Err(schema(format!("{item:?} is not a pipeline of this MR")))
        };
    }
    if file_line_exists(item, req) {
        Ok(item.to_owned())
    } else {
        Err(schema(format!("{item:?} is not a line in the MR's code")))
    }
}

/// `fixed_in_version` of an `already_fixed` answer: later than the failing pipeline's version and
/// not above the latest version among the MR's pipelines.
fn check_fixed_in(output: &Value, req: &ExplainRequest<'_>) -> Result<u32, ClaudeError> {
    let fixed_in = output
        .get("fixed_in_version")
        .and_then(Value::as_u64)
        .and_then(|v| u32::try_from(v).ok())
        .ok_or_else(|| schema("already_fixed needs fixed_in_version"))?;
    let failing = version_of(req.pipelines, req.pipeline_number);
    let latest = req.pipelines.iter().map(|p| p.version).max().unwrap_or(0);
    if fixed_in <= failing || fixed_in > latest {
        return Err(schema(format!(
            "fixed_in_version {fixed_in} is not after version {failing} and up to {latest}"
        )));
    }
    Ok(fixed_in)
}

/// The explanation in `structured_output`, checked against the request.
pub fn explanation_of(
    output: &Value,
    req: &ExplainRequest<'_>,
) -> Result<PipelineExplanation, ClaudeError> {
    let text = |name: &str| {
        output
            .get(name)
            .and_then(Value::as_str)
            .map(str::trim)
            .ok_or_else(|| schema(format!("{name} is missing or not a string")))
    };
    let verdict = verdict_of(text("verdict")?).ok_or_else(|| schema("unknown verdict"))?;
    let fixed_in_version = match verdict {
        Verdict::AlreadyFixed => Some(check_fixed_in(output, req)?),
        _ => None,
    };
    let title = text("title")?;
    if title.is_empty() {
        return Err(schema("the title is empty"));
    }
    let explanation = text("explanation")?;
    let items = output
        .get("evidence")
        .and_then(Value::as_array)
        .ok_or_else(|| schema("evidence is missing or not a list"))?;
    if items.len() > EVIDENCE_MAX {
        return Err(schema("more than 4 evidence items"));
    }
    let evidence = items
        .iter()
        .map(|item| {
            item.as_str()
                .ok_or_else(|| schema("an evidence item is not a string"))
                .and_then(|s| check_evidence(s, req))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let retry_recommended = output
        .get("retry_recommended")
        .and_then(Value::as_bool)
        .ok_or_else(|| schema("retry_recommended is missing or not a boolean"))?;
    Ok(PipelineExplanation {
        verdict,
        fixed_in_version,
        title: clamp(title, TITLE_MAX),
        explanation: clamp(explanation, EXPLANATION_MAX),
        evidence,
        retry_recommended,
        suggested_comment: clamp(text("suggested_comment")?, COMMENT_MAX),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f20_7_the_log_keeps_its_end_and_the_diff_its_start() {
        let log = format!("{}END", "é".repeat(LOG_MAX));
        let kept = log_file(&log);
        assert!(kept.ends_with("END") && kept.starts_with("… ("));
        assert!(kept.len() < LOG_MAX + 100);
        let diff = format!("START{}", "x".repeat(DIFF_MAX));
        assert!(diff_file(&diff).starts_with("START"));
        assert_eq!(log_file("short"), "short");
    }

    #[test]
    fn f20_7_the_pipelines_file_names_each_pipeline_and_the_job() {
        let points = [PipelinePoint {
            number: 7,
            version: 0,
            status: "failed".into(),
            job_status: "failed".into(),
        }];
        assert_eq!(
            pipelines_file(&points),
            "pipeline #7 · version unknown · failed · this job: failed\n"
        );
        assert_eq!(version_of(&points, 7), 0);
        assert_eq!(version_of(&points, 8), 0);
    }

    #[test]
    fn f20_7_evidence_paths_stay_inside_the_worktree() {
        assert!(inside(Path::new("src/a.cs")));
        assert!(!inside(Path::new("../a.cs")));
        assert!(!inside(Path::new("/etc/a.cs")));
    }
}
