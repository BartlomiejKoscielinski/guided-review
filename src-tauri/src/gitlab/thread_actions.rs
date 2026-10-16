//! Actions on an existing MR thread (F-11.2, M5 decisions 1 and 2), each one request sent at
//! once: Resolve and Reopen are `PUT /projects/:id/merge_requests/:iid/discussions/:id?resolved=`,
//! Reply is `POST …/discussions/:id/notes` (docs/05 › GitLab REST API v4). None of them is a draft
//! note or touches the approval (06 › T7).
//!
//! The discussion ID comes from the UI, so it is checked before it becomes part of a path: GitLab's
//! IDs are SHA-1 hex strings, and anything that is not plain letters and digits never reaches
//! GitLab (a `../approve` must not walk up to another endpoint).

use serde_json::{Value, json};

use super::client::{GitlabClient, project_id};
use super::discussions::{self, Thread, ThreadNote};
use super::error::GitlabError;

/// The discussion's path under its MR, or `NotFound` for an ID GitLab can't have issued.
fn discussion_path(project: &str, iid: u64, discussion: &str) -> Result<String, GitlabError> {
    if discussion.is_empty() || !discussion.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(GitlabError::NotFound);
    }
    Ok(format!(
        "/projects/{}/merge_requests/{iid}/discussions/{discussion}",
        project_id(project)
    ))
}

/// Resolves (`resolved = true`) or reopens (`false`) the discussion.
pub async fn resolve(
    client: &GitlabClient,
    project: &str,
    iid: u64,
    discussion: &str,
    resolved: bool,
) -> Result<(), GitlabError> {
    let path = discussion_path(project, iid, discussion)?;
    client
        .put(&path, &[("resolved", resolved.to_string())], None)
        .await?;
    Ok(())
}

/// Adds `body` to the discussion as a new note, as written. Returns the note GitLab created, or
/// `None` when GitLab accepted it but its answer can't be read (the reply is sent all the same).
pub async fn reply(
    client: &GitlabClient,
    project: &str,
    iid: u64,
    discussion: &str,
    body: &str,
) -> Result<Option<ThreadNote>, GitlabError> {
    let path = format!("{}/notes", discussion_path(project, iid, discussion)?);
    let response = client.post(&path, &json!({ "body": body })).await?;
    Ok(read_note(response.body))
}

/// The thread `discussion` after a Resolve or Reopen GitLab accepted.
pub fn mark_resolved(threads: &mut [Thread], discussion: &str, resolved: bool) {
    for thread in threads.iter_mut().filter(|t| t.id == discussion) {
        thread.resolved = resolved;
    }
}

/// The thread `discussion` after a reply GitLab accepted: the note follows the ones there.
pub fn append_note(threads: &mut [Thread], discussion: &str, note: ThreadNote) {
    if let Some(thread) = threads.iter_mut().find(|t| t.id == discussion) {
        thread.notes.push(note);
    }
}

fn read_note(body: Value) -> Option<ThreadNote> {
    discussions::parse_note(body)
        .inspect_err(|error| tracing::warn!(%error, "GitLab's reply answer not read"))
        .ok()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;

    #[test]
    fn f11_2_only_plain_discussion_ids_make_a_path() {
        assert_eq!(
            discussion_path("a/b", 6, "6f1c0de9a2b4").unwrap(),
            "/projects/a%2Fb/merge_requests/6/discussions/6f1c0de9a2b4"
        );
        for hostile in ["", "../approve", "%2e%2e", "abc?x=1", "abc#f", "a b", "ą"] {
            assert!(
                matches!(
                    discussion_path("a/b", 6, hostile),
                    Err(GitlabError::NotFound)
                ),
                "{hostile:?}"
            );
        }
    }

    #[test]
    fn f11_2_a_reply_answer_becomes_a_note_and_an_odd_one_is_none() {
        let note = read_note(json!({
            "id": 7, "body": "Thanks.", "created_at": "2026-10-16T09:00:00.000Z",
            "author": { "username": "dev", "name": "Dev Stand-in" }
        }))
        .unwrap();
        assert_eq!(
            (note.id, note.body.as_str(), note.author.name.as_str()),
            (7, "Thanks.", "Dev Stand-in")
        );
        assert!(read_note(json!({ "unexpected": true })).is_none());
    }

    fn thread(id: &str) -> Thread {
        Thread {
            id: id.to_owned(),
            resolvable: true,
            resolved: false,
            position: None,
            notes: Vec::new(),
        }
    }

    #[test]
    fn f11_2_an_accepted_action_changes_only_its_own_thread() {
        let mut threads = vec![thread("a1"), thread("b2")];
        mark_resolved(&mut threads, "b2", true);
        assert_eq!(
            threads.iter().map(|t| t.resolved).collect::<Vec<_>>(),
            [false, true]
        );
        mark_resolved(&mut threads, "b2", false);
        assert!(!threads[1].resolved);

        let note = read_note(json!({
            "id": 9, "body": "On it.", "created_at": "2026-10-16T09:00:00Z",
            "author": { "username": "dev" }
        }))
        .unwrap();
        append_note(&mut threads, "a1", note.clone());
        append_note(&mut threads, "missing", note);
        assert_eq!(threads[0].notes.len(), 1);
        assert_eq!(threads[0].notes[0].author.name, "dev");
        assert!(threads[1].notes.is_empty() && !threads[0].resolved);
    }
}
