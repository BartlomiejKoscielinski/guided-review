//! `job_explain` (F-20.7, M6 decisions 12 and 14): **Explain failure** on S-08, run only on that
//! click. It reads the failed job, its log, the job's suite of the test report and the MR's
//! pipelines from GitLab (read only), prepares the MR's review worktree at the latest head with
//! the existing preparation (fetch + worktree, no plan; `preparing` on `ch`), writes the MR diff
//! and, for a pipeline on an older SHA, the changes since, and asks Claude through the queue
//! (`reading`, then `done` or `failed`). Nothing is posted.

use std::path::Path;
use std::time::Instant;

use tauri::State;
use tauri::ipc::Channel;

use super::claude::{ClaudeApp, after_task, executable};
use super::gitlab::{GitlabApp, connected_client, forget_status_on_auth_error};
use super::review::plan_context;
use super::with_store;
use crate::claude::tasks::pipeline_explain::{
    self, ExplainRequest, PipelineExplanation, PipelinePoint,
};
use crate::claude::tasks::plan_inputs::PlanSource;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::git::Git;
use crate::gitlab::client::GitlabClient;
use crate::gitlab::error::GitlabError;
use crate::gitlab::{jobs, mr, pipelines};
use crate::os::process::Cancel;
use crate::review::job_explain::{self, JobExplainEvent};
use crate::review::pipeline_view::{self, JobState};
use crate::review::prepare::{self, PrepareInput};
use crate::store::{self, Store, repos, worktrees};

/// Pipelines whose jobs are read for the pipelines file (newest first); older ones say so.
const PIPELINES_READ: usize = 10;

fn rest_name<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// Every pipeline of the MR with its version and the status of `job_name` in it.
async fn pipeline_points(
    client: &GitlabClient,
    project: &str,
    iid: u64,
    job_name: &str,
) -> Result<Vec<PipelinePoint>, GitlabError> {
    let tabs = pipeline_view::tabs(client, project, iid).await?;
    let mut points = Vec::with_capacity(tabs.len());
    for (index, tab) in tabs.iter().enumerate() {
        let job_status = if index < PIPELINES_READ {
            jobs::pipeline_jobs(client, project, tab.id, false)
                .await?
                .iter()
                .find(|j| j.name == job_name)
                .map_or_else(|| "none".to_owned(), |j| j.status.clone())
        } else {
            "not read".to_owned()
        };
        points.push(PipelinePoint {
            number: i64::try_from(tab.number).unwrap_or(i64::MAX),
            version: tab.version.unwrap_or(0),
            status: rest_name(&tab.status),
            job_status,
        });
    }
    Ok(points)
}

/// `git diff` of `from..to` in the worktree.
async fn diff(git: &Git, from: &str, to: &str, cancel: &Cancel) -> AppResult<String> {
    let range = format!("{from}..{to}");
    let out = git
        .run(
            ["diff", "--no-color", "--no-ext-diff", range.as_str()],
            cancel,
        )
        .await?;
    Ok(out.stdout)
}

/// Why job `job` of MR `iid` failed: `preparing`, `reading`, then `done` or `failed` on `ch`.
#[tauri::command]
#[allow(clippy::too_many_arguments, reason = "Tauri command arguments")]
pub async fn job_explain(
    gitlab: State<'_, GitlabApp>,
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    project: String,
    iid: u64,
    job: u64,
    ch: Channel<JobExplainEvent>,
) -> AppResult<PipelineExplanation> {
    let emit = move |event: JobExplainEvent| {
        if let Err(error) = ch.send(event) {
            tracing::debug!(%error, "job explain event not delivered");
        }
    };
    let started = Instant::now();
    tracing::info!(%project, iid, job, "explain failure started");
    let result = explain(&gitlab, &claude, &store, &project, iid, job, &emit).await;
    if let Err(error) = &result {
        // The cause stays in the app log; the panel only says it couldn't explain.
        tracing::warn!(
            %project,
            iid,
            job,
            secs = started.elapsed().as_secs(),
            "explain failure failed: {}",
            job_explain::failure_line(error)
        );
        emit(JobExplainEvent::Failed {
            error: error.clone(),
        });
    }
    result
}

async fn explain(
    gitlab: &GitlabApp,
    claude: &ClaudeApp,
    store: &Store,
    project: &str,
    iid: u64,
    job: u64,
    emit: &(dyn Fn(JobExplainEvent) + Send + Sync),
) -> AppResult<PipelineExplanation> {
    let (client, _) = connected_client(gitlab, store).await?;
    let gitlab_read = async {
        let info = jobs::job(&client, project, job).await?;
        let state = JobState::from_rest(&info.status, info.allow_failure);
        if !matches!(state, JobState::Failed | JobState::FailedAllowed) {
            return Ok(Err(AppError::new(
                ErrorCode::InvalidInput,
                "Only a failed job can be explained.",
            )));
        }
        let pipeline = info
            .pipeline
            .clone()
            .ok_or_else(|| GitlabError::Decode(format!("job {job} names no pipeline")))?;
        let raw_log = jobs::trace(&client, project, job).await?;
        let report = match pipelines::test_report(&client, project, pipeline.id).await {
            Ok(report) => job_explain::test_report_summary(&report, &info.name),
            Err(error) => {
                tracing::debug!(%error, "no test report for the explained job");
                String::new()
            }
        };
        let points = pipeline_points(&client, project, iid, &info.name).await?;
        let merge_request = mr::get(&client, project, iid).await?;
        Ok(Ok((info, pipeline, raw_log, report, points, merge_request)))
    }
    .await;
    forget_status_on_auth_error(gitlab, gitlab_read.as_ref().err()).await;
    let (info, pipeline, raw_log, report, points, merge_request) = gitlab_read??;

    let exe = executable(store).await?;
    let settings = with_store(store, |c| store::settings::load(c)).await?;
    let owned = project.to_owned();
    let repo = with_store(store, move |c| repos::by_project(c, &owned))
        .await?
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::InvalidInput,
                format!("No repository is set up for {project}."),
            )
        })?;
    let cancel = Cancel::new();
    let path = prepare::worktree_path(&repo, iid);
    let key = path.to_string_lossy().into_owned();
    let registered = with_store(store, move |c| worktrees::get(c, &key)).await?;
    if job_explain::needs_preparing(
        path.exists(),
        registered.as_ref().and_then(|w| w.head_sha.as_deref()),
        merge_request.sha.as_deref(),
    ) {
        emit(JobExplainEvent::Preparing);
    }
    let phase = Instant::now();
    let git_program = settings.git.path.as_deref().map(Path::new);
    let repo_git = Git::new(git_program, &repo.path);
    let input = PrepareInput {
        git: &repo_git,
        repo: &repo,
        project,
        iid,
        title: &merge_request.title,
        target_branch: &merge_request.target_branch,
    };
    let prepared = prepare::prepare(&input, store, &|_| {}, &cancel).await?;
    tracing::info!(
        secs = phase.elapsed().as_secs(),
        "explain failure: worktree ready"
    );
    let git = Git::new(git_program, &prepared.worktree);
    let mr_diff = diff(&git, &prepared.base_sha, &prepared.head_sha, &cancel).await?;
    let since = if pipeline.sha.is_empty() || pipeline.sha == prepared.head_sha {
        None
    } else {
        match diff(&git, &pipeline.sha, &prepared.head_sha, &cancel).await {
            Ok(changes) => Some(changes),
            Err(error) => {
                tracing::debug!(%error, "the failing pipeline's SHA is not in the worktree");
                None
            }
        }
    };
    let label = format!("pipeline #{} ({})", pipeline.id, pipeline.sha);
    let diff_text = job_explain::diff_text(&mr_diff, since.as_deref().map(|d| (label.as_str(), d)));
    let files: Vec<String> = prepared.files.iter().map(|f| f.path.clone()).collect();
    let source = PlanSource::Mr {
        iid,
        title: merge_request.title.clone(),
        source_branch: merge_request.source_branch.clone(),
        target_branch: merge_request.target_branch.clone(),
    };
    let log = job_explain::log_text(&raw_log);
    let req = ExplainRequest {
        repo_id: repo.id,
        source: &source,
        base_sha: &prepared.base_sha,
        head_sha: &prepared.head_sha,
        cwd: &prepared.worktree,
        job_id: i64::try_from(job).unwrap_or(i64::MAX),
        job_name: &info.name,
        pipeline_number: i64::try_from(pipeline.id).unwrap_or(i64::MAX),
        log_tail: &log,
        test_report: &report,
        diff: &diff_text,
        files: &files,
        pipelines: &points,
    };
    emit(JobExplainEvent::Reading);
    let ctx = plan_context(claude, store, &exe, &settings.claude);
    let phase = Instant::now();
    let on_started = || {
        tracing::info!(
            queued_secs = phase.elapsed().as_secs(),
            "explain failure: claude started"
        );
    };
    let result = pipeline_explain::run(&ctx, &req, &on_started, &cancel)
        .await
        .inspect(|outcome| {
            tracing::info!(
                cached = outcome.cached,
                secs = phase.elapsed().as_secs(),
                "explain failure answered"
            );
        })
        .map(|outcome| outcome.explanation);
    after_task(claude, store, result.as_ref().map(drop)).await;
    let explanation = result.map_err(AppError::from)?;
    emit(JobExplainEvent::Done {
        result: explanation.clone(),
    });
    Ok(explanation)
}
