//! Publish (F-12.5, M5 decisions 8 and 9): the drafts the user ticked, and the summary comment,
//! become GitLab draft notes (one `POST …/draft_notes` each, positions from the session's diff of
//! the reviewed version) and go out in exactly one `bulk_publish`, so the author gets a single
//! notification. Nothing else is sent: no approval, no discussion note.
//!
//! A draft whose note can't be made keeps its tick and gets a reason in plain words (decision 9);
//! the notes that were made still go out in the batch. A note GitLab made is remembered at once
//! with the text it carries (`drafts.gitlab_draft_id` and `gitlab_draft_note`, the summary's in
//! `sessions.summary_json`), so a Retry makes only what is missing and nothing is published twice.
//! Before anything is made, the notes this app made that no longer say what goes out (a draft not
//! asked now, an edited draft, a summary edited or no longer ticked) are deleted, because
//! `bulk_publish` sends every pending note: if one can't be deleted, nothing goes out. A failed
//! batch fails every draft it carried, and the summary. A refused token or an unreachable GitLab
//! stops the run: the drafts left get the same reason without a request each. A failure of GitLab
//! is a `failed` entry (or `summary_failed`), never an `Err`. A published summary is never sent
//! again.
//!
//! Not built yet (follow-up of F-12.5): the re-map of positions to a newer version of the MR
//! (decision 10b). Positions are anchored to the reviewed version's `diff_refs`, and nothing sets
//! `drafts.outdated` yet.

use std::collections::HashSet;

use serde::Serialize;
use ts_rs::TS;

use super::drafts::{Draft, DraftError};
use super::note_position::note_position;
use super::publish_store::{
    Pending, forget_note, mark_published, pending, remember_failure, remember_note,
};
use super::step_context::MrRef;
use crate::error::AppError;
use crate::git::model::FileDiff;
use crate::gitlab::client::GitlabClient;
use crate::gitlab::draft_notes::{self, DiffRefs};
use crate::gitlab::error::GitlabError;
use crate::store::sessions as sessions_summary;
use crate::store::{Store, StoreError};

pub use super::publish_reason::{
    LINE_GONE, REFUSED, UNREACHABLE, VERSION_GONE, reason, stops_the_run,
};

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
/// went out, the drafts that failed with their reason, and why the summary didn't go out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PublishOutcome {
    pub published: Vec<String>,
    pub summary: bool,
    pub failed: Vec<PublishFailure>,
    /// The summary comment was asked and didn't go out: why, in plain words (decision 9).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub summary_failed: Option<String>,
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

/// The asked drafts, each once, in the order asked; a published one isn't sent again.
fn asked<'a>(all: &'a [Pending], ids: &[String]) -> Result<Vec<&'a Draft>, PublishError> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for id in ids {
        let pending = all
            .iter()
            .find(|p| &p.draft.id == id)
            .ok_or_else(|| DraftError::NotFound(id.clone()))?;
        if !pending.published && seen.insert(id.as_str()) {
            out.push(&pending.draft);
        }
    }
    Ok(out)
}

/// The summary text that goes out: ticked with text and not published yet.
fn summary_text<'a>(req: &PublishRequest<'a>) -> Result<Option<&'a str>, PublishError> {
    let published = req
        .store
        .with_conn(|c| sessions_summary::summary_published(c, req.session))?;
    Ok(req.summary.filter(|t| !t.trim().is_empty() && !published))
}

/// Deletes the GitLab draft notes this app made that no longer say what goes out, so the batch
/// can't send them (see the module docs). `Some(reason)` when one could not be deleted.
async fn delete_stale_notes(
    req: &PublishRequest<'_>,
    text: Option<&str>,
) -> Result<Option<String>, PublishError> {
    let all = req.store.with_conn(|c| Ok(pending(c, req.session)))??;
    let wanted: HashSet<&str> = req.ids.iter().map(String::as_str).collect();
    // (the draft, or None for the summary; the note)
    let mut stale: Vec<(Option<&str>, i64)> = all
        .iter()
        .filter(|p| !p.published)
        .filter(|p| !(wanted.contains(p.draft.id.as_str()) && p.note_is_current()))
        .filter_map(|p| {
            p.gitlab_draft_id
                .map(|note| (Some(p.draft.id.as_str()), note))
        })
        .collect();
    let summary = req
        .store
        .with_conn(|c| sessions_summary::summary_note(c, req.session))?;
    // A summary no longer sent, or whose text changed.
    if let Some((note, carries)) = summary
        && (text.is_none() || carries.as_deref() != text)
    {
        stale.push((None, note));
    }
    let (mr, session) = (req.mr, req.session);
    for (draft, note) in stale {
        match draft_notes::delete(req.client, &mr.project, mr.iid, note).await {
            // Gone already (deleted in GitLab's web UI): nothing left to send.
            Ok(()) | Err(GitlabError::NotFound) => req.store.with_conn(|c| match draft {
                Some(id) => forget_note(c, id),
                None => sessions_summary::set_summary_draft(c, session, None),
            })?,
            Err(error) => {
                tracing::warn!(%error, "an outdated draft note could not be deleted");
                return Ok(Some(reason(&error)));
            }
        }
    }
    Ok(None)
}

/// The note of a draft: made now, or the one an earlier attempt made.
enum Note {
    Made,
    Failed(String),
}

/// Publishes the ticked drafts and the summary comment in one batch (see the module docs).
pub async fn run(req: &PublishRequest<'_>) -> Result<PublishOutcome, PublishError> {
    let text = summary_text(req)?;
    // Unknown drafts are refused before GitLab is asked.
    asked(
        &req.store.with_conn(|c| Ok(pending(c, req.session)))??,
        req.ids,
    )?;
    if let Some(why) = delete_stale_notes(req, text).await? {
        return fail_all(req.store, req.session, req.ids, text, &why);
    }
    let all = req.store.with_conn(|c| Ok(pending(c, req.session)))??;
    let selected = asked(&all, req.ids)?;
    let mut summary_note = req
        .store
        .with_conn(|c| sessions_summary::summary_draft(c, req.session))?;

    let (mr, refs) = (req.mr, req.refs);
    let mut stopped: Option<String> = None;
    let mut notes: Vec<(&str, Note)> = Vec::with_capacity(selected.len());
    for draft in selected {
        let id = draft.id.as_str();
        let made_before = all
            .iter()
            .any(|p| p.draft.id == id && p.gitlab_draft_id.is_some());
        let note = if made_before {
            Note::Made
        } else if let Some(reason) = &stopped {
            Note::Failed(reason.clone())
        } else {
            let position = match &draft.position {
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
                &draft.body,
                position.as_ref().map(|p| (refs, p)),
            )
            .await;
            match made.map(|n| i64::try_from(n.id)) {
                Ok(Ok(made)) => {
                    req.store
                        .with_conn(|c| remember_note(c, id, made, &draft.body))?;
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
    let mut summary_failed: Option<String> = None;
    if let (Some(text), None) = (text, summary_note) {
        if let Some(why) = &stopped {
            summary_failed = Some(why.clone());
        } else {
            match draft_notes::create(req.client, &mr.project, mr.iid, text, None).await {
                Ok(note) => match i64::try_from(note.id) {
                    Ok(made) => {
                        req.store.with_conn(|c| {
                            sessions_summary::set_summary_draft(c, req.session, Some((made, text)))
                        })?;
                        summary_note = Some(made);
                    }
                    Err(_) => {
                        summary_failed = Some(reason(&GitlabError::Decode("note id".into())));
                    }
                },
                Err(error) => {
                    tracing::warn!(%error, "summary comment not made");
                    summary_failed = Some(reason(&error));
                }
            }
        }
    }

    let carried = notes.iter().any(|(_, n)| matches!(n, Note::Made));
    let mut outcome = PublishOutcome {
        published: Vec::new(),
        summary: false,
        failed: Vec::new(),
        summary_failed: None,
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
                    .with_conn(|c| sessions_summary::set_summary_published(c, req.session))?;
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
            if summary_note.is_some() {
                summary_failed = Some(why);
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
    outcome.summary_failed = summary_failed;
    tracing::info!(
        published = outcome.published.len(),
        failed = outcome.failed.len(),
        summary = outcome.summary,
        summary_failed = outcome.summary_failed.is_some(),
        "drafts published"
    );
    Ok(outcome)
}

/// The outcome when nothing can go out (the reviewed version's `diff_refs` could not be read, or
/// an outdated note could not be deleted): every asked draft not published yet fails with `why`,
/// kept like a failed note's, and so does the summary when it was asked.
pub fn fail_all(
    store: &Store,
    session: &str,
    ids: &[String],
    summary: Option<&str>,
    why: &str,
) -> Result<PublishOutcome, PublishError> {
    let all = store.with_conn(|c| Ok(pending(c, session)))??;
    let mut failed: Vec<PublishFailure> = Vec::new();
    for draft in asked(&all, ids)? {
        store.with_conn(|c| remember_failure(c, &draft.id, why))?;
        failed.push(PublishFailure {
            id: draft.id.clone(),
            reason: why.to_owned(),
        });
    }
    let published = store.with_conn(|c| sessions_summary::summary_published(c, session))?;
    let summary_asked = summary.is_some_and(|t| !t.trim().is_empty()) && !published;
    Ok(PublishOutcome {
        published: Vec::new(),
        summary: false,
        failed,
        summary_failed: summary_asked.then(|| why.to_owned()),
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
