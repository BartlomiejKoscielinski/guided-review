//! The thread check's inputs and the check of its answer (F-13.3, M5 decision 12). A candidate is
//! an open thread written on another head than the reviewed one, whose head the repository still
//! has (a force-push may have removed it: left out, not an error); its later commits are
//! `<thread head>..<reviewed head>`. The threads file names each candidate's discussion id and
//! later commits, never the head it was written on; the commits file is `git log -p` of every
//! later commit, size-capped per commit and in total, each commit keeping its id and subject.

use std::collections::HashSet;

use serde_json::Value;

use super::thread_check::ThreadHint;
use crate::claude::error::ClaudeError;
use crate::claude::result::clamp;
use crate::git::Git;
use crate::git::error::GitError;
use crate::gitlab::discussions::{self, NOTE_MAX, Thread};
use crate::os::process::Cancel;
use crate::review::thread_place;

/// The schema's `maxLength` of a hint; a longer one is clamped with "…".
pub const HINT_MAX: usize = 60;
/// Bytes of one commit's message and diff in the commits file; the rest is cut.
pub const COMMIT_MAX: usize = 40_000;
/// Bytes of all diffs in the commits file; later commits keep only their id and subject.
pub const LOG_MAX: usize = 300_000;
/// Separates the commits of `git log` (ASCII record separator).
const RECORD: char = '\u{1e}';

/// An open thread written on an older head, with the commits since (oldest first, full ids).
#[derive(Debug, Clone)]
pub struct Candidate<'a> {
    pub thread: &'a Thread,
    pub later: Vec<String>,
}

/// Open (resolvable, not resolved) and written on another head than the reviewed `head`.
pub fn is_candidate(thread: &Thread, head: &str) -> bool {
    thread.is_open()
        && thread
            .position
            .as_ref()
            .is_some_and(|p| thread_place::written_on_another_head(&p.head_sha, head))
}

fn git_failed(error: GitError) -> ClaudeError {
    ClaudeError::failed(format!("git: {error}"))
}

fn lines(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_owned)
        .collect()
}

/// The candidates among `threads` with their later commits. A thread whose head is gone from the
/// repository, or that has no later commit, is left out.
pub async fn candidates<'a>(
    git: &Git,
    threads: &'a [Thread],
    head: &str,
    cancel: &Cancel,
) -> Result<Vec<Candidate<'a>>, ClaudeError> {
    let mut out = Vec::new();
    for thread in threads.iter().filter(|t| is_candidate(t, head)) {
        let Some(from) = thread.position.as_ref().map(|p| p.head_sha.as_str()) else {
            continue;
        };
        let exists = ["cat-file", "-e", &format!("{from}^{{commit}}")];
        if git.run(exists, cancel).await.is_err() {
            continue;
        }
        let range = format!("{from}..{head}");
        let listed = git
            .run(["rev-list", "--reverse", range.as_str()], cancel)
            .await
            .map_err(git_failed)?;
        let later = lines(&listed.stdout);
        if !later.is_empty() {
            out.push(Candidate { thread, later });
        }
    }
    Ok(out)
}

/// The threads file: per candidate its discussion id, place, later commits and notes. Note
/// bodies are teammates' text: untrusted data for Claude (`system-common.md`).
pub fn threads_file(candidates: &[Candidate<'_>]) -> String {
    let mut out = String::new();
    for Candidate { thread, later } in candidates {
        out.push_str(&format!(
            "Thread {} · {}\n  Later commits: {}\n",
            thread.id,
            discussions::place(thread.position.as_ref()),
            later.join(", ")
        ));
        for note in &thread.notes {
            let body = clamp(note.body.trim(), NOTE_MAX).replace('\n', "\n    ");
            out.push_str(&format!(
                "  - {} ({}): {body}\n",
                note.author.username, note.created_at
            ));
        }
    }
    out
}

/// Every later commit of the candidates once, the longest range's order first.
fn union(candidates: &[Candidate<'_>]) -> Vec<String> {
    let mut ranges: Vec<&Vec<String>> = candidates.iter().map(|c| &c.later).collect();
    ranges.sort_by_key(|later| std::cmp::Reverse(later.len()));
    let mut seen = HashSet::new();
    ranges
        .into_iter()
        .flatten()
        .filter(|sha| seen.insert(sha.as_str()))
        .cloned()
        .collect()
}

/// `text` cut to at most `max` bytes on a character boundary.
fn cut(text: &str, max: usize) -> &str {
    let mut end = max.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// The commits file from `git log` output (records of id, subject, then message body and diff).
pub fn render_log(log: &str) -> String {
    let mut out = String::new();
    let mut total = 0;
    for record in log.split(RECORD).filter(|r| !r.trim().is_empty()) {
        let (sha, rest) = record.split_once('\n').unwrap_or((record, ""));
        let (subject, body) = rest.split_once('\n').unwrap_or((rest, ""));
        out.push_str(&format!("Commit {} · {}\n", sha.trim(), subject.trim()));
        let body = body.trim_matches('\n');
        let room = LOG_MAX.saturating_sub(total).min(COMMIT_MAX);
        let kept = cut(body, room);
        out.push_str(kept);
        total += kept.len();
        if kept.len() < body.len() {
            out.push_str(&format!(
                "\n… ({} more bytes of this commit left out: size cap)",
                body.len() - kept.len()
            ));
        }
        out.push_str("\n\n");
    }
    out
}

/// The commits file: every later commit of the candidates with its diff (`git log -p`).
pub async fn commits_file(
    git: &Git,
    candidates: &[Candidate<'_>],
    cancel: &Cancel,
) -> Result<String, ClaudeError> {
    let shas = union(candidates);
    let spec = git
        .spec([
            "log",
            "--no-color",
            "--stdin",
            "--no-walk=unsorted",
            "-p",
            "--format=%x1e%H%n%s%n%n%b",
        ])
        .stdin(format!("{}\n", shas.join("\n")));
    let output = git.run_spec(spec, cancel, &[0]).await.map_err(git_failed)?;
    Ok(render_log(&output.stdout))
}

fn schema(detail: impl Into<String>) -> ClaudeError {
    ClaudeError::Schema(detail.into())
}

/// The full id of `text` among `later`: the id itself or a unique prefix of at least 7
/// characters.
fn commit_in(text: &str, later: &[String]) -> Option<String> {
    if text.len() < 7 || !text.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let text = text.to_ascii_lowercase();
    let mut matches = later
        .iter()
        .filter(|sha| sha.to_ascii_lowercase().starts_with(&text));
    match (matches.next(), matches.next()) {
        (Some(sha), None) => Some(sha.clone()),
        _ => None,
    }
}

/// The hints in `structured_output`, in Claude's order. A discussion that is not a candidate or
/// named twice, a commit outside that thread's later commits, a blank hint or another shape is
/// `CLAUDE_SCHEMA`.
pub fn hints_of(
    output: &Value,
    candidates: &[Candidate<'_>],
) -> Result<Vec<ThreadHint>, ClaudeError> {
    let items = output
        .get("addressed")
        .and_then(Value::as_array)
        .ok_or_else(|| schema("addressed is missing or not a list"))?;
    let mut seen = HashSet::new();
    let mut hints = Vec::with_capacity(items.len());
    for item in items {
        let field = |name: &str| {
            item.get(name)
                .and_then(Value::as_str)
                .ok_or_else(|| schema(format!("{name} is missing or not a string")))
        };
        let id = field("discussion_id")?;
        let candidate = candidates
            .iter()
            .find(|c| c.thread.id == id)
            .ok_or_else(|| schema(format!("{id:?} is not a thread to check")))?;
        if !seen.insert(id) {
            return Err(schema(format!("{id:?} is named twice")));
        }
        let commit = commit_in(field("commit")?.trim(), &candidate.later).ok_or_else(|| {
            schema(format!(
                "the commit for {id:?} is not one of its later commits"
            ))
        })?;
        let hint = field("hint")?.trim();
        if hint.is_empty() {
            return Err(schema(format!("the hint for {id:?} is empty")));
        }
        hints.push(ThreadHint {
            discussion_id: id.to_owned(),
            commit,
            hint: clamp(hint, HINT_MAX),
        });
    }
    Ok(hints)
}

#[cfg(test)]
#[path = "thread_check_tests.rs"]
mod tests;
