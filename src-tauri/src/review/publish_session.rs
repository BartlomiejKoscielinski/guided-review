//! Publish (N) and Retry of one session (F-12.5, F-12.7). A review publishes on the reviewed
//! version: its `diff_refs` and its diff place the line comments. A "drafts only" session (M5
//! decision 15) has neither (no plan, no worktree, empty SHAs), so it never reads a diff: its
//! comments on the MR go out on the MR's latest version, and a line comment fails with a reason
//! that names the way out (open a review of the MR, which takes the draft and has the diff).
//!
//! When the MR has a newer version than the reviewed one, [`publish_in`] with the session's
//! repository moves the line comments to it (decision 10b, [`publish_remap`]); a draft whose line
//! is gone fails with [`publish::LINE_GONE`], outdated and unticked, and nothing is sent for it.

use std::future::Future;

use super::drafts;
use super::model::SessionStatus;
use super::publish::{self, PublishError, PublishFailure, PublishOutcome, PublishRequest};
use super::publish_remap::{self, Repo};
use super::publish_store::mark_outdated;
use super::step_context::MrRef;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::git::model::FileDiff;
use crate::gitlab::client::GitlabClient;
use crate::gitlab::draft_notes::{self, DiffRefs};
use crate::os::process::Cancel;
use crate::store::{self, Store};

/// One Publish of `session`, the drafts `ids` (in the list's order) and the summary comment.
/// `files` reads the reviewed diff; only a review asks for it. Without the repository, comments
/// stay on the reviewed version even when the MR has a newer one.
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
    publish_in(client, store, session, mr, ids, summary, files, None).await
}

/// [`publish`], with the session's repository `repo` to move the line comments to the MR's
/// latest version when it is newer than the reviewed one (decision 10b).
#[allow(clippy::too_many_arguments, reason = "one Publish names all of them")]
pub async fn publish_in<F, Fut>(
    client: &GitlabClient,
    store: &Store,
    session: &str,
    mr: &MrRef,
    ids: &[String],
    summary: Option<&str>,
    files: F,
    repo: Option<&Repo>,
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
    // The reviewed version's SHAs, and the latest version's when the MR moved on.
    let versions =
        draft_notes::reviewed_and_latest_refs(client, &mr.project, mr.iid, &row.head_sha).await;
    let why = match versions {
        Ok((Some(reviewed), latest)) => {
            let newer = latest.filter(|l| l.head_sha != reviewed.head_sha);
            if let (Some(latest), Some(repo)) = (newer, repo) {
                let at = OnVersion {
                    files: &files,
                    reviewed: &reviewed,
                    latest: &latest,
                    repo,
                };
                if let Some(outcome) =
                    on_newer(client, store, session, mr, ids, summary, &at).await?
                {
                    return Ok(outcome);
                }
            }
            let request = PublishRequest {
                client,
                store,
                session,
                mr,
                refs: &reviewed,
                files: &files,
                ids,
                summary,
            };
            return Ok(publish::run(&request).await?);
        }
        Ok((None, _)) => publish::VERSION_GONE.to_owned(),
        Err(error) => publish::reason(&error),
    };
    Ok(publish::fail_all(store, session, ids, summary, &why)?)
}

/// The reviewed version and the MR's newer one.
struct OnVersion<'a> {
    files: &'a [FileDiff],
    reviewed: &'a DiffRefs,
    latest: &'a DiffRefs,
    repo: &'a Repo,
}

/// Publish on the MR's newer version (decision 10b): the line comments moved there, the outdated
/// ones held back as failures in the list's order. `None` when the versions can't be read.
async fn on_newer(
    client: &GitlabClient,
    store: &Store,
    session: &str,
    mr: &MrRef,
    ids: &[String],
    summary: Option<&str>,
    at: &OnVersion<'_>,
) -> Result<Option<PublishOutcome>, PublishError> {
    let all = store.with_conn(|c| Ok(drafts::list(c, session)))??;
    let cancel = Cancel::new();
    let remap_of = publish_remap::remap(
        at.repo,
        &all,
        ids,
        at.files,
        at.reviewed,
        at.latest,
        &cancel,
    );
    let Some(remapped) = remap_of.await else {
        return Ok(None);
    };
    for id in &remapped.outdated {
        store.with_conn(|c| mark_outdated(c, id, publish::LINE_GONE))?;
    }
    let left: Vec<String> = ids
        .iter()
        .filter(|id| !remapped.outdated.contains(id))
        .cloned()
        .collect();
    let request = PublishRequest {
        client,
        store,
        session,
        mr,
        refs: at.latest,
        files: at.files,
        ids: &left,
        summary,
    };
    let mut outcome = publish::run_on(&request, Some(&remapped.moved)).await?;
    if !remapped.outdated.is_empty() {
        outcome
            .failed
            .extend(remapped.outdated.iter().map(|id| PublishFailure {
                id: id.clone(),
                reason: publish::LINE_GONE.to_owned(),
            }));
        outcome
            .failed
            .sort_by_key(|f| ids.iter().position(|id| *id == f.id));
    }
    Ok(Some(outcome))
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
