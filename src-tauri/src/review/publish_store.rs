//! What Publish keeps per draft (F-12.5, migrations 008 and 009): the GitLab draft note a Publish
//! attempt made, the text it carries and the version it was placed on (migration 010), the reason a draft failed, and when it was published.

use rusqlite::{Connection, params};

use super::drafts::{self, Draft};
use super::publish::PublishError;
use crate::gitlab::draft_notes::DiffRefs;
use crate::store::StoreError;

/// A draft of the session as Publish sees it.
pub(super) struct Pending {
    pub draft: Draft,
    /// The GitLab draft note an earlier attempt made and GitLab still holds.
    pub gitlab_draft_id: Option<i64>,
    /// The text that note carries; `None` when it isn't known.
    pub note_text: Option<String>,
    /// The version that note was placed on ([`refs_key`]); `None` for a note without a position.
    pub note_refs: Option<String>,
    pub published: bool,
}

/// How a note's version is kept: `base_sha start_sha head_sha`.
pub(super) fn refs_key(refs: &DiffRefs) -> String {
    format!("{} {} {}", refs.base_sha, refs.start_sha, refs.head_sha)
}

impl Pending {
    /// The note GitLab holds still says what the draft says, where it goes now: a line comment's
    /// note sits on `refs` (the version this Publish places line comments on), a note without a
    /// position stays without one (an outdated draft goes out as a general comment).
    pub fn note_is_current(&self, refs: &DiffRefs) -> bool {
        let placed = self.draft.position.is_some() && !self.draft.outdated;
        self.gitlab_draft_id.is_some()
            && self.note_text.as_deref() == Some(self.draft.body.as_str())
            && self.note_refs == placed.then(|| refs_key(refs))
    }
}

pub(super) fn pending(conn: &Connection, session: &str) -> Result<Vec<Pending>, PublishError> {
    let drafts = drafts::list(conn, session)?;
    let mut stmt = conn.prepare(
        "SELECT gitlab_draft_id, published_at IS NOT NULL, gitlab_draft_note, gitlab_draft_refs
         FROM drafts WHERE id = ?1",
    )?;
    let mut out = Vec::with_capacity(drafts.len());
    for draft in drafts {
        let (gitlab_draft_id, published, note_text, note_refs) =
            stmt.query_row([&draft.id], |r| {
                Ok((
                    r.get::<_, Option<i64>>(0)?,
                    r.get::<_, bool>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })?;
        out.push(Pending {
            draft,
            gitlab_draft_id,
            note_text,
            note_refs,
            published,
        });
    }
    Ok(out)
}

/// Remembers the note GitLab made for a draft, the text it carries and the version it was placed
/// on (`None` without a position).
pub(super) fn remember_note(
    conn: &Connection,
    id: &str,
    gitlab_draft_id: i64,
    text: &str,
    refs: Option<&DiffRefs>,
) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE drafts SET gitlab_draft_id = ?2, gitlab_draft_note = ?3, gitlab_draft_refs = ?4,
                error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        params![id, gitlab_draft_id, text, refs.map(refs_key)],
    )?;
    Ok(())
}

/// Forgets a draft's note once GitLab no longer holds it (deleted, or gone already).
pub(super) fn forget_note(conn: &Connection, id: &str) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE drafts SET gitlab_draft_id = NULL, gitlab_draft_note = NULL,
                gitlab_draft_refs = NULL WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub(super) fn remember_failure(
    conn: &Connection,
    id: &str,
    reason: &str,
) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE drafts SET error = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id, reason],
    )?;
    Ok(())
}

/// Marks every draft of the session whose note GitLab holds as published (a batch publishes all
/// of the user's pending notes; Publish deleted the notes of the drafts it doesn't send); returns
/// their ids.
pub(super) fn mark_published(conn: &Connection, session: &str) -> Result<Vec<String>, StoreError> {
    let ids = {
        let mut stmt = conn.prepare(
            "SELECT id FROM drafts WHERE session_id = ?1 AND gitlab_draft_id IS NOT NULL
             AND published_at IS NULL ORDER BY created_at, rowid",
        )?;
        stmt.query_map([session], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
    };
    conn.execute(
        "UPDATE drafts SET published_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                published_note_id = gitlab_draft_id, error = NULL,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE session_id = ?1 AND gitlab_draft_id IS NOT NULL AND published_at IS NULL",
        [session],
    )?;
    Ok(ids)
}

/// A draft whose line is gone from the MR's newer version (decision 10b): outdated, unticked, and
/// `reason` kept like a failed note's.
pub(super) fn mark_outdated(conn: &Connection, id: &str, reason: &str) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE drafts SET outdated = 1, include = 0, error = ?2,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id, reason],
    )?;
    Ok(())
}
