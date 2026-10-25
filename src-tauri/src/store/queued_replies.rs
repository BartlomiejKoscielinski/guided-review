//! Replies queued for the next push (F-26.5, ADR-014) in `queued_replies(id, project, iid,
//! discussion_id, body, resolve, after_sha, state, error, replied)`. **Commit** on S-10 queues
//! "Fixed in <sha>. <one sentence>." for the thread it fixed; **Push and reply** sends it once the
//! commit `after_sha` is on the remote branch. One open (`queued`) reply per discussion of an MR:
//! queueing again replaces its text, switch and commit and keeps its ID. `error` is the last failure
//! in plain words (the Retry state); `replied` is set once GitLab took the note, so a retry after a
//! failed Resolve never posts it twice. Nothing here sends anything (M7 decision 12).

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;
use ts_rs::TS;

use super::StoreError;

/// The reply **Commit** queues for a thread.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewQueuedReply {
    pub project: String,
    pub iid: u64,
    pub discussion: String,
    pub body: String,
    pub resolve: bool,
    /// The full SHA of the commit the reply names; it must be on the remote branch first.
    pub after_sha: String,
}

/// A queued (or sent) reply as S-10 shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QueuedReply {
    pub id: String,
    #[serde(skip)]
    #[ts(skip)]
    pub project: String,
    #[serde(skip)]
    #[ts(skip)]
    pub iid: u64,
    pub discussion: String,
    pub body: String,
    pub resolve: bool,
    pub after_sha: String,
    /// `queued` until GitLab took the reply (and the Resolve, when on); then `sent`.
    #[ts(type = "'queued' | 'sent'")]
    pub state: String,
    /// The last failure in plain words; `None` after a success.
    pub error: Option<String>,
    /// GitLab already took the note (a failed Resolve is what is left).
    #[serde(skip)]
    #[ts(skip)]
    pub replied: bool,
}

pub const QUEUED: &str = "queued";
pub const SENT: &str = "sent";

const COLUMNS: &str =
    "id, project, iid, discussion_id, body, resolve, after_sha, state, error, replied";

fn read(row: &Row<'_>) -> rusqlite::Result<QueuedReply> {
    Ok(QueuedReply {
        id: row.get(0)?,
        project: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        iid: u64::try_from(row.get::<_, Option<i64>>(2)?.unwrap_or_default()).unwrap_or_default(),
        discussion: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        body: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        resolve: row.get::<_, Option<bool>>(5)?.unwrap_or(true),
        after_sha: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        state: row
            .get::<_, Option<String>>(7)?
            .unwrap_or_else(|| QUEUED.to_owned()),
        error: row.get(8)?,
        replied: row.get(9)?,
    })
}

fn iid_param(iid: u64) -> i64 {
    i64::try_from(iid).unwrap_or(i64::MAX)
}

/// Queues `reply`, or replaces the open reply of its discussion (same ID). A changed commit
/// starts over: the note of the earlier commit was not about this one.
pub fn queue(conn: &Connection, reply: &NewQueuedReply) -> Result<QueuedReply, StoreError> {
    let iid = iid_param(reply.iid);
    let open: Option<(String, String)> = conn
        .query_row(
            "SELECT id, after_sha FROM queued_replies
             WHERE project = ?1 AND iid = ?2 AND discussion_id = ?3 AND state = ?4",
            params![reply.project, iid, reply.discussion, QUEUED],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                ))
            },
        )
        .optional()?;
    let id = match open {
        Some((id, after_sha)) => {
            conn.execute(
                "UPDATE queued_replies SET body = ?2, resolve = ?3, after_sha = ?4, error = NULL,
                 replied = CASE WHEN ?5 THEN replied ELSE 0 END WHERE id = ?1",
                params![
                    id,
                    reply.body,
                    reply.resolve,
                    reply.after_sha,
                    after_sha == reply.after_sha
                ],
            )?;
            id
        }
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO queued_replies
                 (id, project, iid, discussion_id, body, resolve, after_sha, state, error, replied)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, 0)",
                params![
                    id,
                    reply.project,
                    iid,
                    reply.discussion,
                    reply.body,
                    reply.resolve,
                    reply.after_sha,
                    QUEUED
                ],
            )?;
            id
        }
    };
    get(conn, &id)?.ok_or(StoreError::Sql(rusqlite::Error::QueryReturnedNoRows))
}

/// The reply `id`, queued or sent; `None` for an unknown ID.
pub fn get(conn: &Connection, id: &str) -> Result<Option<QueuedReply>, StoreError> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM queued_replies WHERE id = ?1"),
            params![id],
            read,
        )
        .optional()?)
}

/// The replies of MR `iid` of `project` not sent yet, oldest first (S-10 on reopen, M7 decision
/// 12).
pub fn pending(conn: &Connection, project: &str, iid: u64) -> Result<Vec<QueuedReply>, StoreError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM queued_replies WHERE project = ?1 AND iid = ?2 AND state = ?3 \
         ORDER BY rowid"
    ))?;
    let rows = stmt
        .query_map(params![project, iid_param(iid), QUEUED], read)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// The discussions of MR `iid` of `project` with a reply not sent yet (S-10's "Fixed locally ·
/// not pushed" tag).
pub fn pending_discussions(
    conn: &Connection,
    project: &str,
    iid: u64,
) -> Result<HashSet<String>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT discussion_id FROM queued_replies WHERE project = ?1 AND iid = ?2 AND state = ?3",
    )?;
    let ids = stmt
        .query_map(params![project, iid_param(iid), QUEUED], |row| {
            row.get::<_, Option<String>>(0)
        })?
        .filter_map(Result::transpose)
        .collect::<Result<HashSet<_>, _>>()?;
    Ok(ids)
}

/// Keeps the reply queued with `error`, the failure in plain words, for the Retry state.
pub fn mark_failed(conn: &Connection, id: &str, error: &str) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE queued_replies SET error = ?2 WHERE id = ?1",
        params![id, error],
    )?;
    Ok(())
}

/// GitLab took the note; a retry only resolves.
pub fn mark_replied(conn: &Connection, id: &str) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE queued_replies SET replied = 1 WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Everything the reply asked for reached GitLab.
pub fn mark_sent(conn: &Connection, id: &str) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE queued_replies SET state = ?2, error = NULL, replied = 1 WHERE id = ?1",
        params![id, SENT],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use crate::store::Store;

    fn new(discussion: &str, after_sha: &str) -> NewQueuedReply {
        NewQueuedReply {
            project: "sandbox/gr-sandbox".to_owned(),
            iid: 6,
            discussion: discussion.to_owned(),
            body: "Fixed in 9e1d4b7. Backoff doubles.".to_owned(),
            resolve: true,
            after_sha: after_sha.to_owned(),
        }
    }

    #[test]
    fn f26_5_requeueing_the_same_commit_keeps_the_note_already_taken() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|conn| {
                let first = queue(conn, &new("abc", "9e1d4b7"))?;
                mark_replied(conn, &first.id)?;
                let same = queue(conn, &new("abc", "9e1d4b7"))?;
                assert!(same.replied);
                let other = queue(conn, &new("abc", "1234567"))?;
                assert_eq!(other.id, first.id);
                assert!(!other.replied, "a new commit gets its own note");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn f26_5_a_sent_reply_is_no_longer_pending_and_the_next_one_gets_a_new_id() {
        let store = Store::open_in_memory().unwrap();
        store
            .with_conn(|conn| {
                let first = queue(conn, &new("abc", "9e1d4b7"))?;
                mark_failed(conn, &first.id, "Push failed.")?;
                assert_eq!(
                    get(conn, &first.id)?.unwrap().error.as_deref(),
                    Some("Push failed.")
                );
                mark_sent(conn, &first.id)?;
                let sent = get(conn, &first.id)?.unwrap();
                assert_eq!((sent.state.as_str(), sent.error), (SENT, None));
                assert!(pending_discussions(conn, "sandbox/gr-sandbox", 6)?.is_empty());
                let next = queue(conn, &new("abc", "1234567"))?;
                assert_ne!(next.id, first.id);
                Ok(())
            })
            .unwrap();
    }
}
