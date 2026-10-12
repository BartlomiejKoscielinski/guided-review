//! Opening a teammate's MR (F-01.3, F-02.3): the repository of its project (switching the
//! active one, M2 decision 7), the MR from GitLab (404 → F-01.5 copy), preparation (F-05)
//! and the session row (status Planning, S-02).

use std::path::Path;

use rusqlite::Connection;

use super::model::{Layout, Mode};
use super::prepare::{self, PrepareError, PrepareInput, PrepareProgress};
use super::sessions::{OpenedSession, new_session};
use crate::error::{AppError, ErrorCode};
use crate::git::Git;
use crate::gitlab::client::GitlabClient;
use crate::gitlab::error::GitlabError;
use crate::gitlab::mr;
use crate::os::process::Cancel;
use crate::source::Source;
use crate::source::error::SourceError;
use crate::source::open::Resolved;
use crate::store::repos::{self, RepoRow};
use crate::store::{Store, StoreError, sessions};

#[derive(Debug, thiserror::Error)]
pub enum OpenMrError {
    /// F-01.5: "No merge request !999 in mobile/mobile-app".
    #[error("No merge request !{iid} in {project}")]
    NotFound { iid: u64, project: String },
    #[error(transparent)]
    Source(#[from] SourceError),
    #[error(transparent)]
    Gitlab(GitlabError),
    #[error(transparent)]
    Prepare(#[from] PrepareError),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("the session could not be saved: {0}")]
    Save(#[from] serde_json::Error),
}

impl From<OpenMrError> for AppError {
    fn from(error: OpenMrError) -> Self {
        match error {
            OpenMrError::NotFound { .. } => {
                AppError::new(ErrorCode::GitlabNotFound, error.to_string())
            }
            OpenMrError::Source(e) => e.into(),
            OpenMrError::Gitlab(e) => e.into(),
            OpenMrError::Prepare(e) => e.into(),
            OpenMrError::Store(e) => e.into(),
            OpenMrError::Save(e) => {
                AppError::internal("The session could not be saved.").with_detail(e.to_string())
            }
        }
    }
}

/// The repository to open `!iid` in and its project: the configured repository of `project`
/// (made active when it isn't, decision 7), or the active one when `project` is absent.
pub fn resolve_repo(
    conn: &Connection,
    project: Option<&str>,
) -> Result<(RepoRow, String), OpenMrError> {
    let Some(project) = project.map(str::trim).filter(|p| !p.is_empty()) else {
        let active = repos::active(conn)?.ok_or(SourceError::NoRepository)?;
        let project = active
            .gitlab_project
            .clone()
            .ok_or(SourceError::NoProject)?;
        return Ok((active, project));
    };
    let repo = repos::by_project(conn, project)?
        .ok_or_else(|| SourceError::UnknownProject(project.to_owned()))?;
    if repos::active(conn)?.map(|a| a.id) != Some(repo.id) {
        repos::switch(conn, repo.id)?;
    }
    let project = repo
        .gitlab_project
        .clone()
        .unwrap_or_else(|| project.to_owned());
    Ok((repo, project))
}

/// How a new session starts (Settings › Review).
#[derive(Debug, Clone, Copy)]
pub struct SessionDefaults {
    pub mode: Mode,
    pub layout: Layout,
}

pub struct OpenMr<'a> {
    pub client: &'a GitlabClient,
    pub store: &'a Store,
    /// `git.path` from Settings.
    pub git_program: Option<&'a Path>,
    pub repo: &'a RepoRow,
    pub project: &'a str,
    pub iid: u64,
    pub defaults: SessionDefaults,
}

pub async fn open_mr(
    ctx: &OpenMr<'_>,
    progress: &(dyn Fn(PrepareProgress) + Send + Sync),
    cancel: &Cancel,
) -> Result<OpenedSession, OpenMrError> {
    let fetched = tokio::select! {
        result = mr::get(ctx.client, ctx.project, ctx.iid) => result,
        () = cancel.cancelled() => return Err(PrepareError::Cancelled.into()),
    };
    let info = fetched.map_err(|error| match error {
        GitlabError::NotFound => OpenMrError::NotFound {
            iid: ctx.iid,
            project: ctx.project.to_owned(),
        },
        other => OpenMrError::Gitlab(other),
    })?;
    let git = Git::new(ctx.git_program, &ctx.repo.path);
    let input = PrepareInput {
        git: &git,
        repo: ctx.repo,
        project: ctx.project,
        iid: ctx.iid,
        title: &info.title,
        target_branch: &info.target_branch,
    };
    let prepared = prepare::prepare(&input, ctx.store, progress, cancel).await?;
    let resolved = Resolved {
        source: Source::Mr {
            project: ctx.project.to_owned(),
            iid: ctx.iid,
        },
        base_sha: prepared.base_sha,
        head_sha: prepared.head_sha,
    };
    let (mut row, opened) = new_session(
        ctx.repo.id,
        resolved,
        ctx.defaults.mode,
        ctx.defaults.layout,
    )?;
    row.worktree = Some(prepared.worktree.to_string_lossy().into_owned());
    let store = ctx.store.clone();
    tokio::task::spawn_blocking(move || store.with_conn(|c| sessions::insert(c, &row)))
        .await
        .map_err(|_| StoreError::Poisoned)??;
    Ok(opened)
}
