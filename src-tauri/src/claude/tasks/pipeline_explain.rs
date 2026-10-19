//! Explain failure (F-20.7, M6 decisions 12 and 14; docs/05 › Tasks: Pipeline explain, the "MR
//! description and pipeline" group, `prompts/pipeline-explain.md`,
//! `schemas/pipeline-explain.schema.json`). **Explain failure** on S-08 asks why a failed job
//! failed. Inputs are files in the task folder, readable through `--add-dir`: the job's log tail
//! (capped at 200 KB, its end kept), the job's test report summary, the MR diff and the MR's
//! pipelines with this job's result (`pipeline_explain_inputs.rs`); Claude runs in the MR's review
//! worktree and the argv comes only from `runner::read_only_args` (ADR-022, ADR-025 risk). The
//! answer is checked again here (`fixed_in_version`, evidence files and pipelines) and cached in
//! `claude_cache` per job, prompt version and model; a cache hit starts no `claude` process.
//! Nothing is posted: the suggested comment reaches the drafts only on Add to drafts.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use ts_rs::TS;

use super::pipeline_explain_inputs as inputs;
use super::plan::Context;
use super::plan_inputs::PlanSource;
use crate::claude::error::ClaudeError;
use crate::claude::exec;
use crate::claude::models::{self, TaskGroup};
use crate::claude::prompts;
use crate::claude::queue::Priority;
use crate::claude::runner::{self, OutputFormat, Task};
use crate::claude::task_dir::TaskDir;
use crate::os::process::Cancel;
use crate::review::plan_cache::{self, CacheKey, TaskSettings};

/// `claude_cache.task` of failure explanations.
pub const TASK: &str = "pipeline-explain";
const TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// One pipeline of the MR as the pipelines file lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PipelinePoint {
    /// GitLab's pipeline id ("#18342").
    pub number: i64,
    /// The MR version of its SHA; 0 when no version has it.
    pub version: u32,
    pub status: String,
    /// The status of the explained job's name in that pipeline ("none" when it has no such job).
    pub job_status: String,
}

/// Explain failure of one failed job of an MR's pipeline.
#[derive(Clone)]
pub struct ExplainRequest<'a> {
    pub repo_id: i64,
    /// The MR: the prompt names its `!iid` and title.
    pub source: &'a PlanSource,
    pub base_sha: &'a str,
    /// The MR's latest head, which the review worktree is at.
    pub head_sha: &'a str,
    /// The MR's review worktree; Claude's working directory and the root of `file:line` evidence.
    pub cwd: &'a Path,
    pub job_id: i64,
    pub job_name: &'a str,
    /// The pipeline the job ran in.
    pub pipeline_number: i64,
    /// The log as the panel shows it (decision 10); capped again at 200 KB.
    pub log_tail: &'a str,
    /// The job's suite of the pipeline's test report; may be empty.
    pub test_report: &'a str,
    /// The MR diff (decision 12).
    pub diff: &'a str,
    /// The MR's changed files (paths relative to the worktree).
    pub files: &'a [String],
    /// Every pipeline of the MR, newest first.
    pub pipelines: &'a [PipelinePoint],
}

/// Claude's verdict (decision 14's tag).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Verdict {
    CausedByMr,
    AlreadyFixed,
    Unrelated,
    Flaky,
    Unknown,
}

/// The IPC result of `job_explain` (S-08's "Why it failed").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "JobExplanation")]
pub struct PipelineExplanation {
    pub verdict: Verdict,
    /// Only with `AlreadyFixed`: the version that fixes it.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixed_in_version: Option<u32>,
    pub title: String,
    pub explanation: String,
    /// `file:line` or `pipeline #N`, checked against the worktree and the MR's pipelines.
    pub evidence: Vec<String>,
    pub retry_recommended: bool,
    /// Empty when the author needs to do nothing (no Suggested comment block).
    pub suggested_comment: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExplainOutcome {
    pub explanation: PipelineExplanation,
    /// Came from `claude_cache`.
    pub cached: bool,
}

/// The cache key: the job id (a retried job is a new id), the prompt version and the model.
pub fn key(ctx: &Context<'_>, req: &ExplainRequest<'_>) -> CacheKey {
    CacheKey::new(
        TASK,
        req.repo_id,
        req.source.subject(),
        "",
        "",
        std::iter::once(format!("job:{}", req.job_id)),
        None,
        TaskSettings::for_group(ctx.settings, TaskGroup::Mr),
    )
}

/// The cached answer when it still passes the checks (the worktree may have moved on).
fn cached(ctx: &Context<'_>, key: &CacheKey, req: &ExplainRequest<'_>) -> Option<ExplainOutcome> {
    match ctx.store.with_conn(|conn| plan_cache::get(conn, key)) {
        Ok(Some(output)) => inputs::explanation_of(&output, req)
            .ok()
            .map(|explanation| ExplainOutcome {
                explanation,
                cached: true,
            }),
        Ok(None) => None,
        Err(error) => {
            tracing::warn!(%error, "pipeline explain cache unavailable");
            None
        }
    }
}

/// The cached explanation, or a run of `claude` (`Priority::Interactive`: the reviewer clicked
/// and waits) that is cached on success. `on_started` runs once the queue lets the run start
/// (never on a cache hit).
pub async fn run(
    ctx: &Context<'_>,
    req: &ExplainRequest<'_>,
    on_started: &(dyn Fn() + Sync),
    cancel: &Cancel,
) -> Result<ExplainOutcome, ClaudeError> {
    let PlanSource::Mr { iid, title, .. } = req.source else {
        return Err(ClaudeError::Invalid(
            "A failure is explained for a merge request.".into(),
        ));
    };
    let key = key(ctx, req);
    if let Some(hit) = cached(ctx, &key, req) {
        return Ok(hit);
    }
    let _permit = ctx.queue.acquire(Priority::Interactive, cancel).await?;
    if let Some(hit) = cached(ctx, &key, req) {
        return Ok(hit);
    }
    on_started();

    let io = |e: std::io::Error| ClaudeError::failed(format!("task folder: {e}"));
    let dir = TaskDir::create(ctx.tmp_root).map_err(io)?;
    let file = |name: &str, content: &str| {
        dir.write(name, content)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(io)
    };
    let version = inputs::version_of(req.pipelines, req.pipeline_number);
    let prompt = prompts::render(
        prompts::PIPELINE_EXPLAIN,
        &[
            ("iid", &iid.to_string()),
            ("title", title),
            ("job_name", req.job_name),
            ("pipeline", &req.pipeline_number.to_string()),
            ("version", &inputs::version_text(version)),
            (
                "log_file",
                &file("log.txt", &inputs::log_file(req.log_tail))?,
            ),
            (
                "test_report_file",
                &file("test-report.txt", req.test_report)?,
            ),
            (
                "diff_file",
                &file("diff.txt", &inputs::diff_file(req.diff))?,
            ),
            (
                "pipelines_file",
                &file("pipelines.txt", &inputs::pipelines_file(req.pipelines))?,
            ),
        ],
    );
    let system = dir
        .write(
            "system-common.md",
            &prompts::system_common(ctx.settings.lang),
        )
        .map_err(io)?;
    let resolved = models::resolve(ctx.settings, TaskGroup::Mr);
    let task = Task {
        output: OutputFormat::Json,
        json_schema: Some(prompts::PIPELINE_EXPLAIN_SCHEMA.trim().to_owned()),
        model: resolved.model,
        effort: resolved.effort,
        system_prompt_file: system,
        task_dir: dir.path().to_path_buf(),
        persist_session: false,
        resume: None,
    };
    let result = exec::run_task(
        ctx.exe,
        runner::read_only_args(&task),
        req.cwd,
        &prompt,
        dir.path(),
        TIMEOUT,
        cancel,
    )
    .await?;
    let output = result
        .structured_output
        .ok_or_else(|| ClaudeError::Schema("no structured output".into()))?;
    let explanation = inputs::explanation_of(&output, req)?;
    if let Err(error) = ctx
        .store
        .with_conn(|conn| plan_cache::put(conn, &key, &output))
    {
        tracing::warn!(%error, "pipeline explanation not cached");
    }
    Ok(ExplainOutcome {
        explanation,
        cached: false,
    })
}
