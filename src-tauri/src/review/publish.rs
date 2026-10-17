//! Publish (F-12.5, M5 decisions 8 and 9): the drafts the user ticked, and the summary comment,
//! become GitLab draft notes (one `POST …/draft_notes` each, positions from the session's diff of
//! the reviewed version) and go out in exactly one `bulk_publish`, so the author gets a single
//! notification. Nothing else is sent: no approval, no discussion note.
//!
//! A draft whose note can't be made keeps its tick and gets a reason in plain words (decision 9);
//! the notes that were made still go out in the batch. A note GitLab made is remembered at once
//! (`drafts.gitlab_draft_id`, the summary's in `sessions.summary_json`), so a Retry makes only
//! what is missing and nothing is published twice. A failed batch fails every draft it carried.
//! A refused token or an unreachable GitLab stops the run: the drafts left get the same reason
//! without a request each. A failure of GitLab is a `failed` entry, never an `Err`.

use std::collections::HashSet;

use rusqlite::{Connection, params};
use serde::Serialize;
use ts_rs::TS;

use super::drafts::{self, Draft, DraftError};
use super::note_position::note_position;
use super::step_context::MrRef;
use crate::error::AppError;
use crate::git::model::FileDiff;
use crate::gitlab::client::GitlabClient;
use crate::gitlab::draft_notes::{self, DiffRefs};
use crate::gitlab::error::GitlabError;
use crate::store::sessions as sessions_summary;
use crate::store::{Store, StoreError};

pub const LINE_GONE: &str = "the line is no longer in the MR";
pub const REFUSED: &str = "GitLab refused the token";
pub const UNREACHABLE: &str = "GitLab is unreachable";

/// One Publish (or Retry) of a session's drafts.
pub struct PublishRequest<'a> {
    pub client: &'a GitlabClient,
    pub store: &'a Store,
    pub session: &'a str,
    pub mr: &'a MrRef,
    /// `diff_refs` of the reviewed version.
    pub refs: &'a DiffRefs,
    /// The session's diff of the reviewed version.
    pub files: &'a [FileDiff],
    /// The ticked drafts in the order of the list.
    pub ids: &'a [String],
    /// The summary comment's text; `None` when none goes out.
    pub summary: Option<&'a str>,
}

/// What a Publish sent: the drafts published (in the order asked), whether the summary comment
/// went out, and the drafts that failed with their reason.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PublishOutcome {
    pub published: Vec<String>,
    pub summary: bool,
    pub failed: Vec<PublishFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PublishFailure {
    pub id: String,
    pub reason: String,
}

#[derive(Debug, thiserror::Error)]
pub enum PublishError {
    #[error(transparent)]
    Draft(#[from] DraftError),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Gitlab(#[from] GitlabError),
}

impl From<rusqlite::Error> for PublishError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(error.into())
    }
}

impl From<PublishError> for AppError {
    fn from(error: PublishError) -> Self {
        match error {
            PublishError::Draft(e) => e.into(),
            PublishError::Store(e) => e.into(),
            PublishError::Gitlab(e) => e.into(),
        }
    }
}

/// Why a request for a draft failed, in the words of decision 9.
pub fn reason(error: &GitlabError) -> String {
    match error {
        GitlabError::Unauthorized | GitlabError::TokenExpired | GitlabError::TokenRevoked => {
            REFUSED.to_owned()
        }
        GitlabError::Unreachable(_) => UNREACHABLE.to_owned(),
        GitlabError::Status {
            status: 400,
            message: Some(message),
        } if is_about_the_line(message) => LINE_GONE.to_owned(),
        GitlabError::Status {
            message: Some(message),
            ..
        }
        | GitlabError::Forbidden {
            message: Some(message),
        } => message.clone(),
        GitlabError::Status {
            status,
            message: None,
        } => format!("GitLab answered {status}"),
        GitlabError::Forbidden { message: None } => {
            "GitLab doesn't allow this for your account".to_owned()
        }
        GitlabError::NotFound => "GitLab didn't find the merge request".to_owned(),
        GitlabError::RateLimited { .. } => "GitLab asks to slow down".to_owned(),
        GitlabError::Decode(_) => "GitLab's answer could not be read".to_owned(),
        other => other.to_string(),
    }
}

/// GitLab's 400 for a position on a line that isn't in the diff names the line code or position.
fn is_about_the_line(message: &str) -> bool {
    let message = message.to_lowercase();
    message.contains("line_code") || message.contains("position")
}

/// The failures after which no further request can succeed.
fn stops_the_run(error: &GitlabError) -> bool {
    matches!(
        error,
        GitlabError::Unauthorized
            | GitlabError::TokenExpired
            | GitlabError::TokenRevoked
            | GitlabError::Unreachable(_)
    )
}

/// A draft of the session as Publish sees it.
struct Pending {
    draft: Draft,
    gitlab_draft_id: Option<i64>,
    published: bool,
}

fn pending(conn: &Connection, session: &str) -> Result<Vec<Pending>, PublishError> {
    let drafts = drafts::list(conn, session)?;
    let mut stmt =
        conn.prepare("SELECT gitlab_draft_id, published_at IS NOT NULL FROM drafts WHERE id = ?1")?;
    let mut out = Vec::with_capacity(drafts.len());
    for draft in drafts {
        let (gitlab_draft_id, published) = stmt.query_row([&draft.id], |r| {
            Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, bool>(1)?))
        })?;
        out.push(Pending {
            draft,
            gitlab_draft_id,
            published,
        });
    }
    Ok(out)
}

fn remember_note(conn: &Connection, id: &str, gitlab_draft_id: i64) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE drafts SET gitlab_draft_id = ?2, error = NULL,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        params![id, gitlab_draft_id],
    )?;
    Ok(())
}

fn remember_failure(conn: &Connection, id: &str, reason: &str) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE drafts SET error = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id, reason],
    )?;
    Ok(())
}

/// Marks every draft of the session whose note GitLab holds as published (a batch publishes all
/// of the user's pending notes); returns their ids.
fn mark_published(conn: &Connection, session: &str) -> Result<Vec<String>, StoreError> {
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

/// The note of a draft: made now, or the one an earlier attempt made.
enum Note {
    Made,
    Failed(String),
}

/// Publishes the ticked drafts and the summary comment in one batch (see the module docs).
pub async fn run(req: &PublishRequest<'_>) -> Result<PublishOutcome, PublishError> {
    let all = req.store.with_conn(|c| Ok(pending(c, req.session)))??;
    let stored_summary = req
        .store
        .with_conn(|c| sessions_summary::summary_draft(c, req.session))?;

    // The asked drafts, each once, in the order asked; a published one isn't sent again.
    let mut seen = HashSet::new();
    let mut selected = Vec::new();
    for id in req.ids {
        let draft = all
            .iter()
            .find(|p| &p.draft.id == id)
            .ok_or_else(|| DraftError::NotFound(id.clone()))?;
        if !draft.published && seen.insert(id.as_str()) {
            selected.push(draft);
        }
    }

    let (mr, refs) = (req.mr, req.refs);
    let mut stopped: Option<String> = None;
    let mut notes: Vec<(&str, Note)> = Vec::with_capacity(selected.len());
    for pending in selected {
        let id = pending.draft.id.as_str();
        let note = if pending.gitlab_draft_id.is_some() {
            Note::Made
        } else if let Some(reason) = &stopped {
            Note::Failed(reason.clone())
        } else {
            let position = match &pending.draft.position {
                Some(at) => match note_position(req.files, at) {
                    Some(position) => Some(position),
                    None => {
                        notes.push((id, Note::Failed(LINE_GONE.to_owned())));
                        continue;
                    }
                },
                None => None,
            };
            let made = draft_notes::create(
                req.client,
                &mr.project,
                mr.iid,
                &pending.draft.body,
                position.as_ref().map(|p| (refs, p)),
            )
            .await;
            match made.map(|n| i64::try_from(n.id)) {
                Ok(Ok(made)) => {
                    req.store.with_conn(|c| remember_note(c, id, made))?;
                    Note::Made
                }
                Ok(Err(_)) => Note::Failed(reason(&GitlabError::Decode("note id".into()))),
                Err(error) => {
                    if stops_the_run(&error) {
                        stopped = Some(reason(&error));
                    }
                    Note::Failed(reason(&error))
                }
            }
        };
        notes.push((id, note));
    }

    // The summary comment: a note without a position, after the drafts.
    let mut summary_note = stored_summary;
    let text = req.summary.filter(|t| !t.trim().is_empty());
    if let (Some(text), None, None) = (text, summary_note, &stopped) {
        match draft_notes::create(req.client, &mr.project, mr.iid, text, None).await {
            Ok(note) => {
                if let Ok(made) = i64::try_from(note.id) {
                    req.store.with_conn(|c| {
                        sessions_summary::set_summary_draft(c, req.session, Some(made))
                    })?;
                    summary_note = Some(made);
                }
            }
            Err(error) => tracing::warn!(%error, "summary comment not made"),
        }
    }

    let carried = notes.iter().any(|(_, n)| matches!(n, Note::Made));
    let mut outcome = PublishOutcome {
        published: Vec::new(),
        summary: false,
        failed: Vec::new(),
    };
    let batch = if carried || summary_note.is_some() {
        Some(draft_notes::bulk_publish(req.client, &mr.project, mr.iid).await)
    } else {
        None
    };
    match batch {
        Some(Ok(())) => {
            let published = req.store.with_conn(|c| mark_published(c, req.session))?;
            // The asked drafts in their order, then any earlier note the batch also carried.
            for (id, note) in &notes {
                if matches!(note, Note::Made) {
                    outcome.published.push((*id).to_owned());
                }
            }
            for id in published {
                if !outcome.published.contains(&id) {
                    outcome.published.push(id);
                }
            }
            if summary_note.is_some() {
                req.store
                    .with_conn(|c| sessions_summary::set_summary_draft(c, req.session, None))?;
                outcome.summary = true;
            }
        }
        Some(Err(error)) => {
            let why = reason(&error);
            for (_, note) in &mut notes {
                if matches!(note, Note::Made) {
                    *note = Note::Failed(why.clone());
                }
            }
        }
        None => {}
    }
    for (id, note) in notes {
        if let Note::Failed(why) = note {
            req.store.with_conn(|c| remember_failure(c, id, &why))?;
            outcome.failed.push(PublishFailure {
                id: id.to_owned(),
                reason: why,
            });
        }
    }
    tracing::info!(
        published = outcome.published.len(),
        failed = outcome.failed.len(),
        summary = outcome.summary,
        "drafts published"
    );
    Ok(outcome)
}

/// The outcome when Publish can't start because GitLab failed before any note (the reviewed
/// version's `diff_refs` could not be read): every asked draft not published yet fails with the
/// reason, kept like a failed note's.
pub fn fail_all(
    store: &Store,
    session: &str,
    ids: &[String],
    error: &GitlabError,
) -> Result<PublishOutcome, PublishError> {
    let why = reason(error);
    let all = store.with_conn(|c| Ok(pending(c, session)))??;
    let mut failed: Vec<PublishFailure> = Vec::new();
    for id in ids {
        let draft = all
            .iter()
            .find(|p| &p.draft.id == id)
            .ok_or_else(|| DraftError::NotFound(id.clone()))?;
        if !draft.published && !failed.iter().any(|f| &f.id == id) {
            store.with_conn(|c| remember_failure(c, id, &why))?;
            failed.push(PublishFailure {
                id: id.clone(),
                reason: why.clone(),
            });
        }
    }
    Ok(PublishOutcome {
        published: Vec::new(),
        summary: false,
        failed,
    })
}

/// The pending draft notes of the user on the MR that this session did not make (decision 8):
/// `bulk_publish` sends them too. Reads only.
pub async fn foreign_drafts(
    client: &GitlabClient,
    store: &Store,
    session: &str,
    mr: &MrRef,
) -> Result<u32, PublishError> {
    let listed = draft_notes::list(client, &mr.project, mr.iid).await?;
    let ours = store.with_conn(|c| {
        let mut stmt = c.prepare(
            "SELECT gitlab_draft_id FROM drafts WHERE session_id = ?1
             AND gitlab_draft_id IS NOT NULL",
        )?;
        let mut ids = stmt
            .query_map([session], |r| r.get::<_, i64>(0))?
            .collect::<Result<HashSet<_>, _>>()?;
        ids.extend(sessions_summary::summary_draft(c, session)?);
        Ok(ids)
    })?;
    let foreign = listed
        .iter()
        .filter(|n| !i64::try_from(n.id).is_ok_and(|id| ours.contains(&id)))
        .count();
    Ok(u32::try_from(foreign).unwrap_or(u32::MAX))
}

#[cfg(test)]
#[path = "publish_tests.rs"]
mod tests;
