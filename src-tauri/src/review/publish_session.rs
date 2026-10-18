//! Publish (N) and Retry of one session (F-12.5, F-12.7). A review publishes on the reviewed
//! version: its `diff_refs` and its diff place the line comments. A "drafts only" session (M5
//! decision 15) has neither (no plan, no worktree, empty SHAs), so it never reads a diff: its
//! comments on the MR go out on the MR's latest version, and a line comment fails with a reason
//! that names the way out (open a review of the MR, which takes the draft and has the diff).

use std::future::Future;

use super::drafts;
use super::model::SessionStatus;
use super::publish::{self, PublishError, PublishOutcome, PublishRequest};
use super::step_context::MrRef;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::git::model::FileDiff;
use crate::gitlab::client::GitlabClient;
use crate::gitlab::draft_notes;
use crate::store::{self, Store};

/// One Publish of `session`, the drafts `ids` (in the list's order) and the summary comment.
/// `files` reads the reviewed diff; only a review asks for it.
pub async fn publish<F, Fut>(
    client: &GitlabClient,
    store: &Store,
    session: &str,
    mr: &MrRef,
    ids: &[String],
    summary: Option<&str>,
    files: F,
) -> AppResult<PublishOutcome>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = AppResult<Vec<FileDiff>>>,
{
    let row = store
        .with_conn(|c| store::sessions::source_of(c, session))?
        .ok_or_else(|| AppError::new(ErrorCode::InvalidInput, "Unknown session."))?;
    if row.status == Some(SessionStatus::DraftsOnly) {
        return Ok(drafts_only(client, store, session, mr, ids, summary).await?);
    }
    let files = files().await?;
    // The reviewed version's SHAs, never another version's: the line numbers come from the
    // reviewed diff. Not built yet (F-12.5 follow-up): decision 10b's re-map of the positions to a
    // newer version of the MR and the outdated drafts it finds.
    let why = match draft_notes::version_refs(client, &mr.project, mr.iid, &row.head_sha).await {
        Ok(Some(refs)) => {
            let request = PublishRequest {
                client,
                store,
                session,
                mr,
                refs: &refs,
                files: &files,
                ids,
                summary,
            };
            return Ok(publish::run(&request).await?);
        }
        Ok(None) => publish::VERSION_GONE.to_owned(),
        Err(error) => publish::reason(&error),
    };
    Ok(publish::fail_all(store, session, ids, summary, &why)?)
}

/// A "drafts only" session: the comments on the MR on its latest version, no diff read; each line
/// comment fails with [`publish::NEEDS_REVIEW`], kept like a failed note's, in the list's order.
async fn drafts_only(
    client: &GitlabClient,
    store: &Store,
    session: &str,
    mr: &MrRef,
    ids: &[String],
    summary: Option<&str>,
) -> Result<PublishOutcome, PublishError> {
    let all = store.with_conn(|c| Ok(drafts::list(c, session)))??;
    let on_line = |id: &String| all.iter().any(|d| &d.id == id && d.position.is_some());
    let (lines, comments): (Vec<String>, Vec<String>) = ids.iter().cloned().partition(on_line);
    let refs = match draft_notes::latest_refs(client, &mr.project, mr.iid).await {
        Ok(Some(refs)) => refs,
        Ok(None) => return publish::fail_all(store, session, ids, summary, publish::NO_VERSION),
        Err(error) => {
            return publish::fail_all(store, session, ids, summary, &publish::reason(&error));
        }
    };
    let request = PublishRequest {
        client,
        store,
        session,
        mr,
        refs: &refs,
        files: &[],
        ids: &comments,
        summary,
    };
    let mut outcome = publish::run(&request).await?;
    if !lines.is_empty() {
        let held = publish::fail_all(store, session, &lines, None, publish::NEEDS_REVIEW)?;
        outcome.failed.extend(held.failed);
        outcome
            .failed
            .sort_by_key(|f| ids.iter().position(|id| *id == f.id));
    }
    Ok(outcome)
}
