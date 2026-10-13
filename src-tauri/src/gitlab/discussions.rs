//! MR discussions, read only (F-06.9, M3 decision 5): `GET /projects/:id/merge_requests/:iid/
//! discussions` → threads. System notes ("requested review from …") are dropped. The threads
//! file renders them for the plan and step tasks; without Claude the aside says "N open threads."
//! Resolve and reply come with F-11 (M5).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use super::account::GitlabUser;
use super::client::{GitlabClient, project_id};
use super::error::GitlabError;
use crate::claude::result::clamp;

/// Pages of 100 discussions followed per MR; more are left out.
pub const MAX_PAGES: u32 = 10;
/// A note body in the threads file is clamped to this many characters.
const NOTE_MAX: usize = 1000;

/// One discussion with its notes; the first note opens it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Thread {
    /// GitLab's discussion ID.
    pub id: String,
    pub resolvable: bool,
    /// Every resolvable note is resolved.
    pub resolved: bool,
    /// Where a diff thread sits; `None` for comments on the MR itself.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<ThreadPosition>,
    pub notes: Vec<ThreadNote>,
}

impl Thread {
    /// Counts as open for "N open threads." and the plan: resolvable and not resolved.
    pub const fn is_open(&self) -> bool {
        self.resolvable && !self.resolved
    }
}

/// A diff position (`position_type: text`); lines are `None` on the side the line isn't on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ThreadPosition {
    pub old_path: String,
    pub new_path: String,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_line: Option<u32>,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_line: Option<u32>,
    /// The head the thread was written against.
    pub head_sha: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ThreadNote {
    pub id: u64,
    pub author: GitlabUser,
    /// Markdown as written; the UI sanitizes it (06 › T10).
    pub body: String,
    /// ISO 8601; the card shows the age.
    pub created_at: String,
}

#[derive(Deserialize)]
struct RawDiscussion {
    id: String,
    #[serde(default)]
    notes: Vec<RawNote>,
}

#[derive(Deserialize)]
struct RawNote {
    id: u64,
    #[serde(default)]
    body: String,
    author: RawAuthor,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    system: bool,
    #[serde(default)]
    resolvable: bool,
    #[serde(default)]
    resolved: Option<bool>,
    #[serde(default)]
    position: Option<RawPosition>,
}

#[derive(Deserialize)]
struct RawAuthor {
    username: String,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Deserialize)]
struct RawPosition {
    #[serde(default)]
    old_path: Option<String>,
    #[serde(default)]
    new_path: Option<String>,
    #[serde(default)]
    old_line: Option<u32>,
    #[serde(default)]
    new_line: Option<u32>,
    #[serde(default)]
    head_sha: Option<String>,
}

/// The MR's threads in GitLab's order (oldest first).
pub async fn list(
    client: &GitlabClient,
    project: &str,
    iid: u64,
) -> Result<Vec<Thread>, GitlabError> {
    let path = format!(
        "/projects/{}/merge_requests/{iid}/discussions",
        project_id(project)
    );
    let (items, _) = client.get_pages(&path, &[], MAX_PAGES).await?;
    parse(items)
}

/// Threads from the discussions JSON; system notes are dropped, and a discussion with nothing
/// else left with them.
pub fn parse(items: Vec<Value>) -> Result<Vec<Thread>, GitlabError> {
    let mut threads = Vec::new();
    for item in items {
        let raw: RawDiscussion = serde_json::from_value(item)
            .map_err(|e| GitlabError::Decode(format!("discussion: {e}")))?;
        let notes: Vec<RawNote> = raw.notes.into_iter().filter(|n| !n.system).collect();
        let Some(first) = notes.first() else {
            continue;
        };
        let resolvable_notes: Vec<&RawNote> = notes.iter().filter(|n| n.resolvable).collect();
        let position = first.position.as_ref().and_then(position);
        threads.push(Thread {
            id: raw.id,
            resolvable: first.resolvable,
            resolved: !resolvable_notes.is_empty()
                && resolvable_notes.iter().all(|n| n.resolved == Some(true)),
            position,
            notes: notes.into_iter().map(note).collect(),
        });
    }
    Ok(threads)
}

fn position(raw: &RawPosition) -> Option<ThreadPosition> {
    let new_path = raw.new_path.clone().or_else(|| raw.old_path.clone())?;
    Some(ThreadPosition {
        old_path: raw.old_path.clone().unwrap_or_else(|| new_path.clone()),
        new_path,
        old_line: raw.old_line,
        new_line: raw.new_line,
        head_sha: raw.head_sha.clone().unwrap_or_default(),
    })
}

fn note(raw: RawNote) -> ThreadNote {
    ThreadNote {
        id: raw.id,
        author: GitlabUser {
            name: raw
                .author
                .name
                .unwrap_or_else(|| raw.author.username.clone()),
            username: raw.author.username,
        },
        body: raw.body,
        created_at: raw.created_at,
    }
}

/// Open threads (resolvable, not resolved).
pub fn open_count(threads: &[Thread]) -> usize {
    threads.iter().filter(|t| t.is_open()).count()
}

/// Already discussed without Claude (02 › S-02, decision 5): "N open threads.", or `None` when
/// nothing is open.
pub fn open_summary(threads: &[Thread]) -> Option<String> {
    match open_count(threads) {
        0 => None,
        1 => Some("1 open thread.".to_owned()),
        n => Some(format!("{n} open threads.")),
    }
}

/// The threads file of the plan and step tasks: one block per thread (status, place, notes),
/// or "none". Note bodies are teammates' text: untrusted data for Claude (`system-common.md`).
pub fn render(threads: &[Thread]) -> String {
    if threads.is_empty() {
        return "none\n".to_owned();
    }
    let mut out = String::new();
    for (index, thread) in threads.iter().enumerate() {
        let status = match (thread.resolvable, thread.resolved) {
            (true, false) => "open",
            (true, true) => "resolved",
            (false, _) => "comment",
        };
        out.push_str(&format!(
            "Thread {} · {status} · {}\n",
            index + 1,
            place(thread.position.as_ref())
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

fn place(position: Option<&ThreadPosition>) -> String {
    let Some(p) = position else {
        return "on the merge request".to_owned();
    };
    let path = if p.old_path == p.new_path {
        p.new_path.clone()
    } else {
        format!("{} (was {})", p.new_path, p.old_path)
    };
    match (p.new_line, p.old_line) {
        (Some(line), _) => format!("{path}:{line} (new)"),
        (None, Some(line)) => format!("{path}:{line} (old, removed line)"),
        (None, None) => format!("{path} (file)"),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use serde_json::json;

    fn diff_thread(resolved: bool) -> Value {
        json!({
            "id": "d1", "individual_note": false,
            "notes": [
                { "id": 1, "body": "Why not async?\nIt blocks.", "author": { "username": "alice", "name": "Alice" },
                  "created_at": "2026-10-12T10:00:00Z", "system": false, "resolvable": true, "resolved": resolved,
                  "type": "DiffNote",
                  "position": { "base_sha": "a", "start_sha": "a", "head_sha": "h1", "position_type": "text",
                                "old_path": "src/Zażółć/A b.cs", "new_path": "src/Zażółć/A b.cs",
                                "old_line": null, "new_line": 42 } },
                { "id": 2, "body": "Fixed.", "author": { "username": "bob", "name": "Bob" },
                  "created_at": "2026-10-12T11:00:00Z", "system": false, "resolvable": true, "resolved": resolved,
                  "type": "DiffNote" }
            ]
        })
    }

    #[test]
    fn f06_9_parses_diff_threads_and_drops_system_notes() {
        let threads = parse(vec![
            diff_thread(false),
            json!({ "id": "s", "individual_note": true, "notes": [
                { "id": 3, "body": "requested review from @alice", "author": { "username": "dev" },
                  "system": true, "resolvable": false } ] }),
            json!({ "id": "c", "individual_note": true, "notes": [
                { "id": 4, "body": "LGTM overall", "author": { "username": "carol" },
                  "created_at": "2026-10-12T12:00:00Z", "system": false, "resolvable": false } ] }),
        ])
        .unwrap();
        assert_eq!(threads.len(), 2);
        let diff = &threads[0];
        assert!(diff.is_open());
        assert_eq!(diff.notes.len(), 2);
        let pos = diff.position.as_ref().unwrap();
        assert_eq!(
            (pos.new_line, pos.old_line, pos.head_sha.as_str()),
            (Some(42), None, "h1")
        );
        assert_eq!(threads[1].notes[0].author.name, "carol");
        assert!(!threads[1].is_open() && threads[1].position.is_none());
        assert_eq!(open_count(&threads), 1);
    }

    #[test]
    fn f06_9_open_summary_without_claude() {
        assert_eq!(open_summary(&[]), None);
        let open = parse(vec![diff_thread(false)]).unwrap();
        assert_eq!(open_summary(&open).as_deref(), Some("1 open thread."));
        let two = [open[0].clone(), open[0].clone()];
        assert_eq!(open_summary(&two).as_deref(), Some("2 open threads."));
        assert_eq!(open_summary(&parse(vec![diff_thread(true)]).unwrap()), None);
    }

    #[test]
    fn f06_9_threads_file() {
        assert_eq!(render(&[]), "none\n");
        let text = render(&parse(vec![diff_thread(false)]).unwrap());
        assert_eq!(
            text,
            "Thread 1 · open · src/Zażółć/A b.cs:42 (new)\n\
             \x20 - alice (2026-10-12T10:00:00Z): Why not async?\n    It blocks.\n\
             \x20 - bob (2026-10-12T11:00:00Z): Fixed.\n"
        );
        let long = json!({ "id": "x", "notes": [{ "id": 9, "body": "y".repeat(1500),
            "author": { "username": "u" }, "resolvable": true, "resolved": true,
            "position": { "old_path": "a.cs", "new_path": "b.cs", "old_line": 3, "new_line": null } }] });
        let text = render(&parse(vec![long]).unwrap());
        assert!(text.starts_with("Thread 1 · resolved · b.cs (was a.cs):3 (old, removed line)\n"));
        assert!(text.trim_end().ends_with('…'));
    }
}
