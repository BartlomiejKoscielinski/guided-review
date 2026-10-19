//! `drafts_publish` and `gitlab_foreign_drafts` (F-12.5, M5 decisions 8 and 9): Publish on S-05
//! is the only path that sends drafts to GitLab, one explicit click each. The MR, its reviewed
//! head and the diff come from the session, never from the UI; the UI names the ticked drafts and
//! the summary text. No Claude Code lookup: publishing runs no `claude` process.

use std::path::Path;

use tauri::State;

use super::gitlab::{GitlabApp, connected_client};
use super::gitlab_threads::session_mr;
use super::review::ReviewApp;
use super::with_store;
use crate::error::AppResult;
use crate::git::Git;
use crate::git::model::FileDiff;
use crate::os::process::Cancel;
use crate::review::drafts::{self, DraftError};
use crate::review::publish::{self, PublishOutcome};
use crate::review::publish_remap::Repo;
use crate::review::publish_session;
use crate::review::step_context;
use crate::source::model::Source;
use crate::store::{self, Store};

/// The session's diff of the reviewed version: the loaded one, else read from git (no plan, no
/// threads, no Claude Code).
async fn session_files(
    review: &ReviewApp,
    store: &Store,
    session: &str,
) -> AppResult<Vec<FileDiff>> {
    if let Some(cx) = review.remembered(session) {
        return Ok(cx.files.clone());
    }
    let settings = with_store(store, |c| store::settings::load(c)).await?;
    let git_program = settings.git.path.as_deref().map(Path::new);
    let no_threads = |_| async { Vec::new() };
    let inputs =
        step_context::load_inputs(store, git_program, session, no_threads, &Cancel::new()).await?;
    Ok(inputs.files)
}

/// The session's repository and source, where the MR's versions are read for the re-map of
/// decision 10b; `None` when the session has none. Reads only the store and settings.
async fn session_repo(store: &Store, session: &str) -> AppResult<Option<Repo>> {
    let settings = with_store(store, |c| store::settings::load(c)).await?;
    let id = session.to_owned();
    let (row, folders) = with_store(store, move |c| {
        Ok((
            store::sessions::source_of(c, &id)?,
            store::sessions::folders(c, &id)?,
        ))
    })
    .await?;
    let (Some(row), Some(folders)) = (row, folders) else {
        return Ok(None);
    };
    let Ok(source) = serde_json::from_str::<Source>(&row.source_json) else {
        return Ok(None);
    };
    let git_program = settings.git.path.as_deref().map(Path::new);
    Ok(Some(Repo {
        git: Git::new(git_program, &folders.checkout),
        source,
    }))
}

/// Publish (N) and Retry: the drafts `ids` (in the list's order) and the summary comment
/// (`None`: none) as GitLab draft notes, then one `bulk_publish` (F-12.5). A GitLab failure is
/// reported per draft in the outcome; an unknown draft or a session without an MR is refused
/// before anything is sent.
#[tauri::command]
pub async fn drafts_publish(
    review: State<'_, ReviewApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
    ids: Vec<String>,
    summary: Option<String>,
) -> AppResult<PublishOutcome> {
    let mr = session_mr(&store, &session).await?;
    let id = session.clone();
    let known = with_store(&store, move |c| Ok(drafts::list(c, &id))).await??;
    // Checked before GitLab is asked, like the mock backend.
    if let Some(missing) = ids.iter().find(|a| !known.iter().any(|d| &d.id == *a)) {
        return Err(DraftError::NotFound(missing.clone()).into());
    }
    let (client, _) = connected_client(&gitlab, &store).await?;
    // A "drafts only" session (F-12.7) never asks for the diff: it has none.
    let files = || session_files(&review, &store, &session);
    let repo = session_repo(&store, &session).await?;
    publish_session::publish_in(
        &client,
        &store,
        &session,
        &mr,
        &ids,
        summary.as_deref(),
        files,
        repo.as_ref(),
    )
    .await
}

/// The draft comments already in GitLab's own review of the session's MR, which a Publish sends
/// too (decision 8). Read only; asked when S-05 opens (never on a restored start, F-30.4) and
/// right before each Publish click.
#[tauri::command]
pub async fn gitlab_foreign_drafts(
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
) -> AppResult<u32> {
    let mr = session_mr(&store, &session).await?;
    let (client, _) = connected_client(&gitlab, &store).await?;
    Ok(publish::foreign_drafts(&client, &store, &session, &mr).await?)
}
