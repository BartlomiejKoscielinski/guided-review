//! The title and description of S-11 New merge request (F-27.2, M7 decisions 15 and 16):
//! `git_mr_title` reads the title from the branch's commits without Claude; `claude_mr_description`
//! runs only on a click (**Write with Claude**, **Shorter version**, **Longer version**, or the
//! self-review's **Draft MR description**) and only fills the fields. Nothing reaches GitLab.

use tauri::State;

use super::claude::{ClaudeApp, after_task, executable};
use super::repo::active_git;
use super::review::plan_context;
use super::with_store;
use crate::claude::tasks::mr_description::{self, MrDescription, MrDescriptionRequest, Variant};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::git::branch_info;
use crate::git::mr_title;
use crate::os::process::Cancel;
use crate::review::drafts;
use crate::store::{self, Store};

/// The title S-11 opens with for an MR into `target` (a branch on origin; the default when
/// missing): a single commit's subject, or the branch name in words for several. Reads only.
#[tauri::command]
pub async fn git_mr_title(store: State<'_, Store>, target: Option<String>) -> AppResult<String> {
    let git = active_git(&store).await?;
    Ok(mr_title::mr_title(&git, target.as_deref(), &Cancel::new()).await?)
}

/// The kept notes of the active repository's latest self-review, as the notes file renders them;
/// empty without one.
async fn kept_notes(store: &Store) -> AppResult<String> {
    let drafts = with_store(store, |c| {
        let Some(repo) = store::repos::active(c)? else {
            return Ok(Ok(Vec::new()));
        };
        Ok(match store::sessions::latest_self_review(c, repo.id)? {
            Some(session) => drafts::list(c, &session),
            None => Ok(Vec::new()),
        })
    })
    .await?
    .map_err(AppError::from)?;
    Ok(mr_description::notes_file(&drafts))
}

/// **Write with Claude** (`variant` normal), **Shorter version** and **Longer version** (F-27.2):
/// the title and the description of an MR of the current branch into `target` (the default when
/// missing). `task` is the UI's ID for `claude_cancel`. Nothing is cached or sent.
#[tauri::command]
pub async fn claude_mr_description(
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    task: String,
    variant: Variant,
    target: Option<String>,
) -> AppResult<MrDescription> {
    let git = active_git(&store).await?;
    let cancel = Cancel::new();
    let target = match target {
        Some(target) => target,
        None => branch_info::branch_info(&git, None, &cancel)
            .await?
            .target
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::InvalidInput,
                    "No branch on origin to merge into.",
                )
            })?,
    };
    let notes = kept_notes(&store).await?;
    let settings = with_store(&store, |c| store::settings::load(c)).await?;
    let exe = executable(&store).await?;
    let ctx = plan_context(&claude, &store, &exe, &settings.claude);
    let req = MrDescriptionRequest {
        git: &git,
        target: &target,
        variant,
        notes: &notes,
    };
    claude.track(&task, &cancel);
    let result = mr_description::run(&ctx, &req, &cancel).await;
    claude.untrack(&task);
    after_task(&claude, &store, result.as_ref().map(drop)).await;
    result.map_err(AppError::from)
}
