//! S-10's thread list (F-26.1, M7 decision 5): the discussions of my own MR as the author answers
//! them. Only resolvable threads count; resolved ones fold into "N resolved earlier". The tag of a
//! thread comes from a fixed rule, never from Claude: Question = the first note ends a sentence
//! with "?" (outside code); Change requested = any other open thread; Fix proposed = an open
//! proposal; Fixed locally · not pushed = a queued reply; Replied / Answered = my note is the last.
//! "N threads to answer" counts open threads whose last note is not mine.

use std::collections::HashSet;

use serde::Serialize;
use ts_rs::TS;

use crate::gitlab::discussions::Thread;

/// The longest excerpt in characters, the ellipsis included; the screen clamps it to two lines.
pub const EXCERPT_MAX: usize = 200;

/// What the first note asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ThreadKind {
    Question,
    Change,
}

/// The status tag of a listed thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ThreadStatus {
    ChangeRequested,
    Question,
    FixProposed,
    FixedLocally,
    Replied,
    Answered,
}

/// One row of the S-10 thread list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AuthorThread {
    /// GitLab's discussion id.
    pub id: String,
    /// Display name of who opened the thread.
    pub author: String,
    /// Their initials ("MK").
    pub avatar: String,
    /// "UploadWorker.cs:46", the file name alone, or "General".
    pub place: String,
    /// The thread's file, repository-relative with "/"; `None` on a General thread (F-26.2).
    pub path: Option<String>,
    /// Its line in the working tree's file to open at; `None` on a General thread or a comment on
    /// a removed line (GitLab sends only `old_line`), which has no line there.
    pub line: Option<u32>,
    /// The first note on one line, cut to `EXCERPT_MAX`.
    pub excerpt: String,
    pub kind: ThreadKind,
    pub status: ThreadStatus,
    /// The conversation in order, full text (F-26.2).
    pub notes: Vec<AuthorNote>,
}

/// One note of a thread's conversation in S-10's thread card (F-26.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AuthorNote {
    /// Display name of who wrote it.
    pub author: String,
    /// Their initials ("MK").
    pub avatar: String,
    /// The whole text, not cut like the excerpt.
    pub body: String,
    /// ISO 8601 as GitLab sends it.
    pub created_at: String,
    /// Written by the signed-in user (the card reads "You").
    pub mine: bool,
}

/// "N resolved earlier · <first excerpt>".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ResolvedSummary {
    #[ts(type = "number")]
    pub count: usize,
    pub first_excerpt: Option<String>,
}

/// The left panel of S-10 below its heading.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AuthorThreads {
    /// The open threads in GitLab's order.
    pub threads: Vec<AuthorThread>,
    /// Open threads whose last note is not mine ("N threads to answer").
    #[ts(type = "number")]
    pub to_answer: usize,
    pub resolved: ResolvedSummary,
}

/// The thread list of my MR. `me` is the signed-in username; `proposals` and `queued` are the
/// discussion ids with an open fix proposal and with a reply queued for the next push.
pub fn of(
    threads: &[Thread],
    me: &str,
    proposals: &HashSet<String>,
    queued: &HashSet<String>,
) -> AuthorThreads {
    let mut list = Vec::new();
    let mut to_answer = 0;
    let mut resolved = ResolvedSummary {
        count: 0,
        first_excerpt: None,
    };
    for thread in threads.iter().filter(|t| t.resolvable) {
        let Some(first) = thread.notes.first() else {
            continue;
        };
        let excerpt = excerpt_of(&first.body);
        if thread.resolved {
            resolved.count += 1;
            if resolved.first_excerpt.is_none() {
                resolved.first_excerpt = Some(excerpt);
            }
            continue;
        }
        let last_mine = thread.notes.last().is_some_and(|n| n.author.username == me);
        if !last_mine {
            to_answer += 1;
        }
        let kind = if is_question(&first.body) {
            ThreadKind::Question
        } else {
            ThreadKind::Change
        };
        list.push(AuthorThread {
            id: thread.id.clone(),
            author: first.author.name.clone(),
            avatar: initials(&first.author.name),
            place: place_of(thread),
            path: thread.position.as_ref().map(|p| p.new_path.clone()),
            line: line_of(thread),
            excerpt,
            kind,
            status: status_of(thread, kind, last_mine, proposals, queued),
            notes: thread
                .notes
                .iter()
                .map(|n| AuthorNote {
                    author: n.author.name.clone(),
                    avatar: initials(&n.author.name),
                    body: n.body.clone(),
                    created_at: n.created_at.clone(),
                    mine: n.author.username == me,
                })
                .collect(),
        });
    }
    AuthorThreads {
        threads: list,
        to_answer,
        resolved,
    }
}

fn status_of(
    thread: &Thread,
    kind: ThreadKind,
    last_mine: bool,
    proposals: &HashSet<String>,
    queued: &HashSet<String>,
) -> ThreadStatus {
    if queued.contains(&thread.id) {
        return ThreadStatus::FixedLocally;
    }
    if proposals.contains(&thread.id) {
        return ThreadStatus::FixProposed;
    }
    match (kind, last_mine) {
        (ThreadKind::Question, true) => ThreadStatus::Answered,
        (ThreadKind::Change, true) => ThreadStatus::Replied,
        (ThreadKind::Question, false) => ThreadStatus::Question,
        (ThreadKind::Change, false) => ThreadStatus::ChangeRequested,
    }
}

/// A "?" ending a sentence in the prose of `body`: followed by whitespace or the end, outside
/// fenced blocks (GitLab suggestions) and inline code. A "?" in a URL query is not one.
fn is_question(body: &str) -> bool {
    let prose = without_code(body);
    let chars: Vec<char> = prose.chars().collect();
    chars
        .iter()
        .enumerate()
        .any(|(i, c)| *c == '?' && chars.get(i + 1).is_none_or(|next| next.is_whitespace()))
}

/// `body` without fenced code blocks and inline code spans (each replaced by a space).
fn without_code(body: &str) -> String {
    let mut prose = String::new();
    let mut fenced = false;
    for line in body.lines() {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
            prose.push('\n');
            continue;
        }
        if fenced {
            continue;
        }
        let mut in_code = false;
        for c in line.chars() {
            if c == '`' {
                in_code = !in_code;
                prose.push(' ');
            } else if !in_code {
                prose.push(c);
            }
        }
        prose.push('\n');
    }
    prose
}

/// The first two words' first letters, upper-cased ("Żaneta Łukasik" → "ŻŁ").
fn initials(name: &str) -> String {
    name.split_whitespace()
        .take(2)
        .filter_map(|word| word.chars().next())
        .flat_map(char::to_uppercase)
        .collect()
}

/// The file name and line where the thread sits (the placed line for an outdated thread), the
/// file name alone, or "General" for a thread on the merge request.
fn place_of(thread: &Thread) -> String {
    let Some(position) = thread.position.as_ref() else {
        return "General".to_owned();
    };
    // GitLab paths always use "/", whatever the platform.
    let name = position
        .new_path
        .rsplit('/')
        .next()
        .unwrap_or(&position.new_path)
        .to_owned();
    let line = if thread.outdated {
        thread
            .placed_line
            .or(position.new_line)
            .or(position.old_line)
    } else {
        position.new_line.or(position.old_line)
    };
    match line {
        Some(line) => format!("{name}:{line}"),
        None => name,
    }
}

/// The working tree's line to open the thread at: the placed line of an outdated thread, else its
/// new line; a comment on a removed line has none.
fn line_of(thread: &Thread) -> Option<u32> {
    let position = thread.position.as_ref()?;
    if thread.outdated {
        thread.placed_line.or(position.new_line)
    } else {
        position.new_line
    }
}

/// `body` on one line (whitespace collapsed), cut to `EXCERPT_MAX` characters with "…".
fn excerpt_of(body: &str) -> String {
    let one_line = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= EXCERPT_MAX {
        return one_line;
    }
    let cut: String = one_line.chars().take(EXCERPT_MAX - 1).collect();
    format!("{}…", cut.trim_end())
}
