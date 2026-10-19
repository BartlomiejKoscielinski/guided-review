//! The thread check of S-05 (F-13.3, M5 decision 12): `claude_thread_check` runs on **Check with
//! Claude** only, never on its own. It reads the MR's threads from GitLab as the Threads tab lists
//! them, judges the open ones written on an older head against the commits since (task events on
//! `ch`) and answers the hints; nothing is resolved. Without a candidate no Claude run starts and
//! Claude Code is not looked up.

use std::path::Path;

use tauri::State;
use tauri::ipc::Channel;

use super::claude::{ClaudeApp, after_task, executable};
use super::gitlab::{GitlabApp, connected_client};
use super::gitlab_threads::session_mr;
use super::review::{ReviewApp, plan_context, sender};
use super::with_store;
use crate::claude::tasks::events::ClaudeTaskEvent;
use crate::claude::tasks::plan_inputs::PlanSource;
use crate::claude::tasks::thread_check::{self, ThreadCheck, ThreadCheckRequest};
use crate::claude::tasks::thread_check_inputs::is_candidate;
use crate::error::{AppError, AppResult};
use crate::git::Git;
use crate::gitlab::discussions;
use crate::os::process::Cancel;
use crate::review::step_context;
use crate::store::{self, Store};

/// What the check needs of the session: the remembered step context's, else the stored session's
/// (no plan needed).
struct Session {
    repo_id: i64,
    source: PlanSource,
    base_sha: String,
    head_sha: String,
    cwd: std::path::PathBuf,
}

/// The hints of the MR's open threads a later commit addressed: `queued`, `started` (not on a
/// cache hit or without a candidate), then `done` or `failed` on `ch`.
#[tauri::command]
pub async fn claude_thread_check(
    review: State<'_, ReviewApp>,
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    session: String,
    ch: Channel<ClaudeTaskEvent<ThreadCheck>>,
) -> AppResult<ThreadCheck> {
    let mr = session_mr(&store, &session).await?;
    let (client, _) = connected_client(&gitlab, &store).await?;
    let threads = discussions::list(&client, &mr.project, mr.iid).await?;
    let settings = with_store(&store, |c| store::settings::load(c)).await?;
    let git_program = settings.git.path.as_deref().map(Path::new);
    let s = match review.remembered(&session) {
        Some(cx) => Session {
            repo_id: cx.repo_id,
            source: cx.source.clone(),
            base_sha: cx.base_sha.clone(),
            head_sha: cx.head_sha.clone(),
            cwd: cx.cwd.clone(),
        },
        None => {
            let none = |_| async { Vec::new() };
            let i = step_context::load_inputs(&store, git_program, &session, none, &Cancel::new())
                .await?;
            Session {
                repo_id: i.repo_id,
                source: i.source,
                base_sha: i.base_sha,
                head_sha: i.head_sha,
                cwd: i.cwd,
            }
        }
    };
    let emit = sender(ch);
    if !threads.iter().any(|t| is_candidate(t, &s.head_sha)) {
        let result = ThreadCheck { hints: Vec::new() };
        emit(ClaudeTaskEvent::Queued);
        emit(ClaudeTaskEvent::Done {
            result: result.clone(),
        });
        return Ok(result);
    }
    let exe = executable(&store).await?;
    let ctx = plan_context(&claude, &store, &exe, &settings.claude);
    let git = Git::new(git_program, &s.cwd);
    let req = ThreadCheckRequest {
        repo_id: s.repo_id,
        source: &s.source,
        base_sha: &s.base_sha,
        head_sha: &s.head_sha,
        cwd: &s.cwd,
        git: &git,
        threads: &threads,
    };
    emit(ClaudeTaskEvent::Queued);
    let started = || emit(ClaudeTaskEvent::Started);
    let result = thread_check::run(&ctx, &req, &started, &Cancel::new())
        .await
        .map(|outcome| ThreadCheck {
            hints: outcome.hints,
        });
    emit(match &result {
        Ok(check) => ClaudeTaskEvent::Done {
            result: check.clone(),
        },
        Err(error) => ClaudeTaskEvent::Failed {
            error: error.clone().into(),
        },
    });
    after_task(&claude, &store, result.as_ref().map(drop)).await;
    result.map_err(AppError::from)
}
