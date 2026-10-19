//! The GitLab draft notes around a Publish (F-12.5, M5 decisions 8, 9 and 10b): the notes this app
//! made that must not go out are deleted before the batch, and the user's own pending notes that
//! this session did not make are counted, because `bulk_publish` sends them too.

use std::collections::HashSet;

use super::publish::{PublishError, PublishRequest, reason};
use super::publish_store::{forget_note, pending};
use super::step_context::MrRef;
use crate::gitlab::client::GitlabClient;
use crate::gitlab::draft_notes;
use crate::gitlab::error::GitlabError;
use crate::store::Store;
use crate::store::sessions as sessions_summary;

/// Deletes the GitLab draft notes this app made that no longer say what goes out, or sit on
/// another version than the one this Publish places line comments on, so the batch can't send
/// them (see [`super::publish`]). `Some(reason)` when one could not be deleted.
pub(super) async fn delete_stale_notes(
    req: &PublishRequest<'_>,
    text: Option<&str>,
) -> Result<Option<String>, PublishError> {
    let all = req.store.with_conn(|c| Ok(pending(c, req.session)))??;
    let wanted: HashSet<&str> = req.ids.iter().map(String::as_str).collect();
    // (the draft, or None for the summary; the note)
    let mut stale: Vec<(Option<&str>, i64)> = all
        .iter()
        .filter(|p| !p.published)
        .filter(|p| !(wanted.contains(p.draft.id.as_str()) && p.note_is_current(req.refs)))
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
