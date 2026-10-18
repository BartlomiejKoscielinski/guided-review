//! What the step and ask tasks of a session need (F-09.6, F-10.1): the source, the files of
//! merge base → head with their hunks, the session's plan from `claude_cache` (S-03 opens after
//! S-02 planned, so this never runs the plan task), the MR's threads and the team rules.
//! Every source (F-17.1): an MR runs in its review worktree; commits and the user's own local
//! changes run in the repository root, without a worktree and without threads.

use std::future::Future;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use super::coverage;
use super::model::Strategy;
use super::mr_summary::MrMeta;
use super::plan_cache;
use super::plan_model::Plan;
use super::source_files;
use super::step_order::{self, StepOrder, StepOrderError};
use super::strategy;
use super::thread_place;
use crate::claude::ClaudeError;
use crate::claude::tasks::ask::AskRequest;
use crate::claude::tasks::plan::{self, Context, PlanRequest};
use crate::claude::tasks::plan_inputs::PlanSource;
use crate::claude::tasks::step::StepRequest;
use crate::claude::tasks::step_inputs::Dismissal;
use crate::error::{AppError, ErrorCode};
use crate::git::model::FileDiff;
use crate::git::{Git, GitError, log};
use crate::gitlab::discussions::Thread;
use crate::os::process::Cancel;
use crate::review::position::LineSelection;
use crate::source::model::Source;
use crate::store::{self, Store, StoreError};

/// The MR a session reviews, for fetching its threads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MrRef {
    pub project: String,
    pub iid: u64,
}

#[derive(Debug, Clone)]
pub struct StepContext {
    pub session_id: String,
    pub repo_id: i64,
    pub source: PlanSource,
    /// `{{project}}`: the GitLab project, else the repository's name.
    pub project: String,
    /// MR sessions only.
    pub mr: Option<MrRef>,
    pub base_sha: String,
    pub head_sha: String,
    /// The review worktree of an MR, else the repository root (F-17.1).
    pub cwd: PathBuf,
    pub files: Vec<FileDiff>,
    pub plan: Plan,
    /// The plan is the app's file-order fallback (Claude failed): File order only, no drag.
    pub fallback: bool,
    pub threads: Vec<Thread>,
    pub rules: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum StepContextError {
    #[error("unknown session")]
    UnknownSession,
    #[error("the merge request of the session is missing")]
    NotMr,
    #[error("the session has no cached plan")]
    PlanNotReady,
    #[error("the session could not be read: {0}")]
    Decode(#[from] serde_json::Error),
    #[error(transparent)]
    Git(#[from] GitError),
    #[error(transparent)]
    Claude(#[from] ClaudeError),
    #[error(transparent)]
    Store(#[from] StoreError),
}

impl From<StepContextError> for AppError {
    fn from(error: StepContextError) -> Self {
        match error {
            StepContextError::UnknownSession => {
                AppError::new(ErrorCode::InvalidInput, "Unknown session.")
            }
            StepContextError::NotMr => AppError::new(
                ErrorCode::InvalidInput,
                "The session's merge request could not be read.",
            ),
            StepContextError::PlanNotReady => {
                AppError::new(ErrorCode::InvalidInput, "The plan isn't ready yet.")
            }
            StepContextError::Decode(e) => {
                AppError::internal("The session could not be read.").with_detail(e.to_string())
            }
            StepContextError::Git(e) => e.into(),
            StepContextError::Claude(e) => e.into(),
            StepContextError::Store(e) => e.into(),
        }
    }
}

/// The review subject of a stored source (`claude_cache.subject`, `dismissals.mr`), one per
/// source (F-17.1).
pub fn subject(source_json: &str) -> Result<String, StepContextError> {
    let source: Source = serde_json::from_str(source_json)?;
    Ok(plan_cache::subject(&source))
}

/// Every file of `base → head` with its hunks (`Hunk.mechanical` set).
pub async fn files(
    git: &Git,
    base: &str,
    head: &str,
    cancel: &Cancel,
) -> Result<Vec<FileDiff>, GitError> {
    source_files::range(git, base, head, cancel).await
}

/// Loads the session `session_id`; `threads` fetches the MR's threads (empty when GitLab
/// can't be reached: the threads are a hint for Claude, not a requirement).
pub async fn load<F, Fut>(
    ctx: &Context<'_>,
    git_program: Option<&Path>,
    session_id: &str,
    threads: F,
    cancel: &Cancel,
) -> Result<StepContext, StepContextError>
where
    F: FnOnce(MrRef) -> Fut,
    Fut: Future<Output = Vec<Thread>>,
{
    let inputs = load_inputs(ctx.store, git_program, session_id, threads, cancel).await?;
    let plan = plan::cached(ctx, &inputs.plan_request()).ok_or(StepContextError::PlanNotReady)?;
    // The session's card counts the steps S-03 shows (F-04.1).
    store::plans::keep_plan(ctx.store, session_id, &plan);
    Ok(StepContext::new(inputs, plan))
}

/// What the plan task needs from a stored MR session (`review_plan`); a [`StepContext`] once
/// planned.
#[derive(Debug)]
pub struct SessionInputs {
    pub session_id: String,
    pub repo_id: i64,
    pub source: PlanSource,
    pub project: String,
    pub mr: Option<MrRef>,
    pub base_sha: String,
    pub head_sha: String,
    pub cwd: PathBuf,
    pub files: Vec<FileDiff>,
    pub threads: Vec<Thread>,
    pub rules: Option<String>,
    pub description: Option<String>,
}

impl SessionInputs {
    pub fn plan_request(&self) -> PlanRequest<'_> {
        PlanRequest {
            repo_id: self.repo_id,
            project: &self.project,
            source: self.source.clone(),
            base_sha: &self.base_sha,
            head_sha: &self.head_sha,
            cwd: &self.cwd,
            description: self.description.as_deref(),
            files: &self.files,
            threads: &self.threads,
            rules: self.rules.as_deref(),
        }
    }
}

/// The session's source, files, threads (see [`load`]), team rules and description (the MR
/// description, or the commit messages of a commits session).
pub async fn load_inputs<F, Fut>(
    store: &Store,
    git_program: Option<&Path>,
    session_id: &str,
    threads: F,
    cancel: &Cancel,
) -> Result<SessionInputs, StepContextError>
where
    F: FnOnce(MrRef) -> Fut,
    Fut: Future<Output = Vec<Thread>>,
{
    let (row, folders) = store.with_conn(|conn| {
        Ok((
            store::sessions::source_of(conn, session_id)?,
            store::sessions::folders(conn, session_id)?,
        ))
    })?;
    let (Some(row), Some(folders)) = (row, folders) else {
        return Err(StepContextError::UnknownSession);
    };
    let repo_id = row.repo_id.ok_or(StepContextError::UnknownSession)?;
    let stored: Source = serde_json::from_str(&row.source_json)?;
    let git = Git::new(git_program, &folders.checkout);
    let (source, mr, description, cwd) = match stored.clone() {
        Source::Mr { project, iid } => {
            let mr_json = row.mr_json.ok_or(StepContextError::NotMr)?;
            let meta: MrMeta = serde_json::from_str(&mr_json)?;
            let source = PlanSource::Mr {
                iid,
                title: meta.title,
                source_branch: meta.source_branch,
                target_branch: meta.target_branch,
            };
            let cwd = folders.worktree.unwrap_or(folders.checkout.clone());
            (source, Some(MrRef { project, iid }), meta.description, cwd)
        }
        // F-17.1: commits and the user's own changes read the repository root, no worktree.
        // A commits session's description is its commit messages (M3 decision 13); local
        // scopes have none.
        Source::Commits { from, to } => {
            let messages = log::messages(&git, from.as_deref(), &to, cancel).await?;
            (
                PlanSource::Commits { from, to },
                None,
                Some(messages).filter(|m| !m.trim().is_empty()),
                folders.checkout.clone(),
            )
        }
        Source::Local { scope } => (
            PlanSource::Local { scope },
            None,
            None,
            folders.checkout.clone(),
        ),
    };
    let project = match &mr {
        Some(mr) => mr.project.clone(),
        None => repo_project(store, repo_id, &folders.checkout)?,
    };
    let rules = plan::team_rules(&git, &row.base_sha, cancel).await?;
    let files = source_files::files(&git, &stored, &row.base_sha, &row.head_sha, cancel).await?;
    let threads = match &mr {
        Some(mr) => {
            let mut threads = threads(mr.clone()).await;
            // Threads written on an older version find their line in this one (F-11.3).
            thread_place::place(&git, &mut threads, &row.base_sha, &row.head_sha, cancel).await;
            threads
        }
        None => Vec::new(),
    };
    Ok(SessionInputs {
        session_id: session_id.to_owned(),
        repo_id,
        source,
        project,
        mr,
        base_sha: row.base_sha,
        head_sha: row.head_sha,
        cwd,
        files,
        threads,
        rules,
        description,
    })
}

/// `{{project}}` of a session without an MR: the repository's GitLab project, else its name,
/// else its folder name.
fn repo_project(store: &Store, repo_id: i64, checkout: &Path) -> Result<String, StepContextError> {
    let repo = store.with_conn(|conn| store::repos::get(conn, repo_id))?;
    Ok(repo
        .and_then(|r| r.gitlab_project.or(Some(r.name)))
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| {
            checkout
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        }))
}

impl StepContext {
    pub fn new(inputs: SessionInputs, plan: Plan) -> Self {
        Self {
            session_id: inputs.session_id,
            repo_id: inputs.repo_id,
            source: inputs.source,
            project: inputs.project,
            mr: inputs.mr,
            base_sha: inputs.base_sha,
            head_sha: inputs.head_sha,
            cwd: inputs.cwd,
            files: inputs.files,
            plan,
            fallback: false,
            threads: inputs.threads,
            rules: inputs.rules,
        }
    }

    /// The session with the app's fallback plan (02 › S-02 Claude failed).
    pub fn fallback(inputs: SessionInputs, plan: Plan) -> Self {
        Self {
            fallback: true,
            ..Self::new(inputs, plan)
        }
    }

    /// The reader's step order (F-06.4, F-06.5); File order for a fallback plan.
    pub fn step_order(&self, conn: &Connection) -> Result<StepOrder, StepOrderError> {
        if self.fallback {
            return Ok(step_order::fallback(&self.plan));
        }
        step_order::load(conn, &self.session_id, &self.plan, &self.hunks())
    }

    /// Picks a strategy (F-06.4); refused on a fallback plan.
    pub fn set_strategy(
        &self,
        conn: &Connection,
        strategy: Strategy,
    ) -> Result<StepOrder, StepOrderError> {
        if self.fallback {
            return Err(StepOrderError::Fallback);
        }
        step_order::set_strategy(conn, &self.session_id, strategy, &self.plan, &self.hunks())
    }

    /// Saves a dragged order (F-06.5); refused on a fallback plan.
    pub fn reorder(
        &self,
        conn: &Connection,
        order: &[String],
    ) -> Result<StepOrder, StepOrderError> {
        if self.fallback {
            return Err(StepOrderError::Fallback);
        }
        step_order::reorder(conn, &self.session_id, order, &self.plan, &self.hunks())
    }

    fn hunks(&self) -> Vec<coverage::HunkRef<'_>> {
        coverage::hunk_refs(&self.files)
    }

    /// `claude_cache.subject` and `dismissals.mr` of this review.
    pub fn subject(&self) -> String {
        self.source.subject()
    }

    /// The steps in the reader's order.
    pub fn order(&self, strategy: Strategy) -> Vec<String> {
        strategy::step_order(&self.plan, strategy, &coverage::hunk_refs(&self.files))
    }

    pub fn step_request<'a>(
        &'a self,
        step_id: &'a str,
        order: &'a [String],
        dismissed: &'a [Dismissal],
    ) -> StepRequest<'a> {
        StepRequest {
            repo_id: self.repo_id,
            source: &self.source,
            base_sha: &self.base_sha,
            head_sha: &self.head_sha,
            cwd: &self.cwd,
            files: &self.files,
            plan: &self.plan,
            step_id,
            order,
            threads: &self.threads,
            rules: self.rules.as_deref(),
            dismissed,
        }
    }

    pub fn ask_request<'a>(
        &'a self,
        step_id: &'a str,
        order: &'a [String],
        question: &'a str,
        selection: Option<&'a LineSelection>,
    ) -> AskRequest<'a> {
        AskRequest {
            session_id: &self.session_id,
            source: &self.source,
            cwd: &self.cwd,
            files: &self.files,
            plan: &self.plan,
            step_id,
            order,
            question,
            selection,
        }
    }
}
