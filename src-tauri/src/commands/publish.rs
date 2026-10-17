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
use crate::error::{AppError, AppResult, ErrorCode};
use crate::git::model::FileDiff;
use crate::gitlab::draft_notes;
use crate::os::process::Cancel;
use crate::review::drafts::{self, DraftError};
use crate::review::publish::{self, PublishOutcome, PublishRequest};
use crate::review::step_context;
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
    let (known, head) = with_store(&store, move |c| {
        let head = store::sessions::source_of(c, &id)?.map(|row| row.head_sha);
        Ok(drafts::list(c, &id).map(|known| (known, head)))
    })
    .await??;
    // Checked before GitLab is asked, like the mock backend.
    if let Some(missing) = ids.iter().find(|a| !known.iter().any(|d| &d.id == *a)) {
        return Err(DraftError::NotFound(missing.clone()).into());
    }
    let head = head.ok_or_else(|| AppError::new(ErrorCode::InvalidInput, "Unknown session."))?;
    let (client, _) = connected_client(&gitlab, &store).await?;
    let files = session_files(&review, &store, &session).await?;
    let refs = match draft_notes::version_refs(&client, &mr.project, mr.iid, &head).await {
        Ok(refs) => refs,
        Err(error) => return Ok(publish::fail_all(&store, &session, &ids, &error)?),
    };
    let request = PublishRequest {
        client: &client,
        store: &store,
        session: &session,
        mr: &mr,
        refs: &refs,
        files: &files,
        ids: &ids,
        summary: summary.as_deref(),
    };
    Ok(publish::run(&request).await?)
}

/// The draft comments already in GitLab's own review of the session's MR, which a Publish sends
/// too (decision 8). Read only; asked when S-05 opens, never on a restored start (F-30.4).
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
