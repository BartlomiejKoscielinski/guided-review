//! The title and description of S-11 New merge request (F-27.2, M7 decisions 15 and 16):
//! `git_mr_title` reads the title from the branch's commits without Claude; `claude_mr_description`
//! runs only on a click (**Write with Claude**, **Shorter version**, **Longer version**, or the
//! self-review's **Draft MR description**) and only fills the fields. Nothing reaches GitLab.
//! `git_merge_check` gives "Before you create" (F-27.5): pushed, conflicts, the self-review and an
//! open MR of the branch; it only reads.

use tauri::State;

use super::claude::{ClaudeApp, after_task, executable};
use super::gitlab::{GitlabApp, active_project, connected_client, forget_status_on_auth_error};
use super::repo::active_git;
use super::review::plan_context;
use super::with_store;
use crate::claude::tasks::mr_description::{self, MrDescription, MrDescriptionRequest, Variant};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::git::branch_info;
use crate::git::merge_check::{self, ExistingMr, MergeCheck, SelfReviewProgress};
use crate::git::mr_title;
use crate::gitlab::branch_mr;
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

/// "Before you create" for an MR of the current branch into `target` (a branch on origin; the
/// default when missing): the git checks, the newest self-review of the repository and an open MR
/// of the branch. Without GitLab (not connected, no project, a failed request) the MR is unknown
/// and left out: it never fails the checks. Reads only; never looks for Claude Code.
#[tauri::command]
pub async fn git_merge_check(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    target: Option<String>,
) -> AppResult<MergeCheck> {
    let git = active_git(&store).await?;
    let mut check = merge_check::merge_check(&git, target.as_deref(), &Cancel::new()).await?;
    check.self_review = latest_self_review(&store).await?;
    check.existing_mr = existing_mr(&gitlab, &store, &check.branch).await;
    Ok(check)
}

async fn latest_self_review(store: &Store) -> AppResult<Option<SelfReviewProgress>> {
    let progress = with_store(store, |c| match store::repos::active(c)? {
        Some(repo) => store::session_progress::latest_self_review(c, repo.id),
        None => Ok(None),
    })
    .await?;
    let count = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    Ok(progress.map(|p| SelfReviewProgress {
        reviewed: count(p.reviewed),
        total: count(p.total),
        notes: count(p.drafts),
    }))
}

async fn existing_mr(gitlab: &GitlabApp, store: &Store, branch: &str) -> Option<ExistingMr> {
    let (client, status) = connected_client(gitlab, store).await.ok()?;
    let project = active_project(store, status.server.as_deref()?)
        .await
        .ok()?;
    match branch_mr::open_for_branch(&client, &project, branch).await {
        Ok(found) => found.map(|mr| ExistingMr {
            iid: mr.iid,
            title: mr.title,
        }),
        Err(error) => {
            tracing::warn!(code = ?AppError::from(error.clone()).code, "open MR lookup failed");
            forget_status_on_auth_error(gitlab, Some(&error)).await;
            None
        }
    }
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
