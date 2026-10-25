//! `fix_propose_thread` (F-25.1, F-25.3 on S-10): Fix with Claude on a change thread of my own
//! MR, run on the click on **Fix with Claude** only. GitLab is read (the MR's author and source
//! branch, the thread's conversation), never written; the run itself is the self-review's
//! (`fix::run_fix`): a scratch worktree, the one file, the guard, a proposal for Accept or Discard.

use std::collections::HashSet;
use std::path::Path;

use serde::Deserialize;
use tauri::State;
use tauri::ipc::Channel;
use ts_rs::TS;

use super::claude::ClaudeApp;
use super::fix::{Note, Run, run_fix};
use super::gitlab::{GitlabApp, connected_client, forget_status_on_auth_error, not_connected};
use super::with_store;
use crate::claude::tasks::events::ClaudeTaskEvent;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::fix::eligibility::fix_allowed;
use crate::fix::proposal::FixProposal;
use crate::fix::proposals::Proposals;
use crate::fix::thread::{AuthorFacts, author_context, same_project, thread_note};
use crate::git::{Git, refs};
use crate::gitlab::{discussions, mr};
use crate::os::process::Cancel;
use crate::review::author_threads;
use crate::source::model::Source;
use crate::store::{self, Store};

/// What a thread's fix starts from: a thread of my MR on S-10.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FixThreadTarget {
    /// The UI's ID of the run, for `claude_cancel`.
    pub task: String,
    pub project: String,
    #[ts(type = "number")]
    pub iid: u64,
    /// The GitLab discussion ID (`AuthorThread.id`).
    pub thread_id: String,
}

/// Fix with Claude on a thread of my MR: `FIX_NOT_ALLOWED` before anything runs unless the MR is
/// mine and the active checkout is its project on its source branch (F-25.1, F-26.8); a question
/// or a General thread is `INVALID_INPUT`. Then `started` and `done` with the proposal.
#[tauri::command]
pub async fn fix_propose_thread(
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    proposals: State<'_, Proposals>,
    target: FixThreadTarget,
    ch: Channel<ClaudeTaskEvent<FixProposal>>,
) -> AppResult<FixProposal> {
    let (client, status) = connected_client(&gitlab, &store).await?;
    let Some(user) = status.user.as_ref() else {
        return Err(not_connected(&status));
    };
    let me = user.username.clone();
    let read = async {
        let info = mr::get(&client, &target.project, target.iid).await?;
        let threads = discussions::list(&client, &target.project, target.iid).await?;
        Ok((info, threads))
    };
    let (info, threads) = match read.await {
        Ok(read) => read,
        Err(error) => {
            forget_status_on_auth_error(&gitlab, Some(&error)).await;
            return Err(AppError::from(error));
        }
    };
    let (settings, active) = with_store(&store, |c| {
        Ok((store::settings::load(c)?, store::repos::active(c)?))
    })
    .await?;
    let active = active.filter(|r| {
        same_project(r.gitlab_project.as_deref(), &target.project) && Path::new(&r.path).is_dir()
    });
    let checkout_branch = match &active {
        Some(repo) => {
            let git = Git::new(settings.git.path.as_deref().map(Path::new), &repo.path);
            refs::current_branch(&git, &Cancel::new())
                .await
                .ok()
                .flatten()
        }
        None => None,
    };
    let cx = author_context(AuthorFacts {
        active_repository: active.is_some(),
        me: Some(me.clone()),
        mr_author: info.author.as_ref().and_then(|a| a.username.clone()),
        mr_source_branch: info.source_branch.clone(),
        checkout_branch,
    });
    let source = Source::Mr {
        project: target.project.clone(),
        iid: target.iid,
    };
    fix_allowed(&source, &cx)?;
    let Some(repo) = active else {
        return Err(AppError::new(
            ErrorCode::FixNotAllowed,
            "Pick a repository first.",
        ));
    };
    let list = author_threads::of(&threads, &me, &HashSet::new(), &HashSet::new());
    let thread = list
        .threads
        .iter()
        .find(|t| t.id == target.thread_id)
        .ok_or_else(|| AppError::new(ErrorCode::InvalidInput, "Unknown thread."))?;
    let note = thread_note(thread)?;
    let note = Note {
        file: note.file,
        line: note.line,
        request: note.request,
    };
    let run = Run {
        claude: &claude,
        store: &store,
        proposals: &proposals,
        settings: &settings,
        repo_id: repo.id,
        repo: Path::new(&repo.path),
        origin: "a review thread on my merge request",
    };
    run_fix(run, &note, &target.task, ch).await
}
