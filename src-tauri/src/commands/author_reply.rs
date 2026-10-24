//! The question threads of S-10 (F-26.7, plan M7 F-26.7): `claude_reply_draft` runs only on the
//! click on **Draft with Claude**; it reads the thread from GitLab and the code at its line from
//! the active checkout (my own) and answers a proposed reply, sending nothing. `author_reply` runs
//! only on the click on **Send reply**: the reply goes to GitLab at once, as written (no queue,
//! no push); the thread stays open until the reviewer resolves it.

use tauri::State;

use super::claude::{ClaudeApp, after_task, executable};
use super::gitlab::{GitlabApp, connected_client, forget_status_on_auth_error};
use super::repo::active_git;
use super::review::plan_context;
use super::with_store;
use crate::claude::tasks::reply_draft::{self, ReplyDraft, ReplyDraftRequest};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::gitlab::error::GitlabError;
use crate::gitlab::{discussions, thread_actions};
use crate::os::process::Cancel;
use crate::store::{self, Store};

/// A proposed answer of mine to `discussion` of my MR `iid` (F-26.7); nothing is sent or cached.
/// A discussion the MR doesn't have is `GITLAB_NOT_FOUND`.
#[tauri::command]
pub async fn claude_reply_draft(
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    project: String,
    iid: u64,
    discussion: String,
) -> AppResult<ReplyDraft> {
    let (client, _) = connected_client(&gitlab, &store).await?;
    let threads = match discussions::list(&client, &project, iid).await {
        Ok(threads) => threads,
        Err(e) => {
            forget_status_on_auth_error(&gitlab, Some(&e)).await;
            return Err(e.into());
        }
    };
    let thread = threads
        .iter()
        .find(|t| t.id == discussion)
        .ok_or_else(|| AppError::from(GitlabError::NotFound))?;
    let git = active_git(&store).await?;
    let settings = with_store(&store, |c| store::settings::load(c)).await?;
    let exe = executable(&store).await?;
    let ctx = plan_context(&claude, &store, &exe, &settings.claude);
    let req = ReplyDraftRequest {
        cwd: git.repo(),
        thread,
    };
    let result = reply_draft::run(&ctx, &req, &|| {}, &Cancel::new()).await;
    after_task(&claude, &store, result.as_ref().map(drop)).await;
    result.map_err(AppError::from)
}

/// **Send reply** (F-26.7): `body` becomes my note of `discussion` at once, as written. A blank
/// body is `INVALID_INPUT` and sends nothing.
#[tauri::command]
pub async fn author_reply(
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    project: String,
    iid: u64,
    discussion: String,
    body: String,
) -> AppResult<()> {
    if body.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            "Write the reply to send.",
        ));
    }
    let (client, _) = connected_client(&gitlab, &store).await?;
    match thread_actions::reply(&client, &project, iid, &discussion, &body).await {
        Ok(_) => Ok(()),
        Err(e) => {
            forget_status_on_auth_error(&gitlab, Some(&e)).await;
            Err(e.into())
        }
    }
}
