//! The plan of a session with its channel events (`review_plan`, docs/04 › IPC contract):
//! `queued`, `started` unless cached, then `done` with the plan and the session's step order,
//! or `failed` (F-06.2, F-06.12). A cached plan starts no `claude` process.

use std::collections::HashSet;

use serde::Serialize;
use ts_rs::TS;

use super::coverage;
use super::plan_model::Plan;
use super::step_context::SessionInputs;
use super::step_order::{self, StepOrder};
use super::step_runs::RunError;
use crate::claude::tasks::events::ClaudeTaskEvent;
use crate::claude::tasks::plan::{self, Context};
use crate::error::AppError;
use crate::git::model::{FileDiff, LineKind};
use crate::os::process::Cancel;

/// S-02's data: the plan, where it came from and the reader's order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlanView {
    pub plan: Plan,
    /// When the cached plan was stored (ISO 8601 UTC): "Plan from cache · <age>"; `None` when
    /// Claude planned just now.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cached_at: Option<String>,
    pub order: StepOrder,
    /// `N files · +add −del` of each row (F-06.3), in the order of `plan.steps`.
    pub step_stats: Vec<ChangeStats>,
    /// The same for each skim group (F-06.6), in the order of `plan.skim`.
    pub skim_stats: Vec<ChangeStats>,
}

/// Files touched and lines added and deleted by a set of hunks.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct ChangeStats {
    pub files: u32,
    pub additions: u32,
    pub deletions: u32,
}

/// The stats of `hunk_ids` among `files`; unknown IDs count nothing.
pub fn change_stats(files: &[FileDiff], hunk_ids: &[String]) -> ChangeStats {
    let wanted: HashSet<&str> = hunk_ids.iter().map(String::as_str).collect();
    let mut stats = ChangeStats::default();
    for file in files {
        let hunks: Vec<_> = file
            .hunks
            .iter()
            .filter(|h| wanted.contains(h.id.as_str()))
            .collect();
        if hunks.is_empty() {
            continue;
        }
        stats.files += 1;
        for line in hunks.iter().flat_map(|h| &h.lines) {
            match line.kind {
                LineKind::Add => stats.additions += 1,
                LineKind::Del => stats.deletions += 1,
                LineKind::Ctx => {}
            }
        }
    }
    stats
}

/// Plans the session (or reads the cached plan) and emits the task events.
pub async fn plan(
    ctx: &Context<'_>,
    inputs: &SessionInputs,
    cancel: &Cancel,
    emit: &(dyn Fn(ClaudeTaskEvent<PlanView>) + Sync),
) -> Result<PlanView, RunError> {
    emit(ClaudeTaskEvent::Queued);
    let started = || emit(ClaudeTaskEvent::Started);
    let result = match plan::run(ctx, &inputs.plan_request(), &started, cancel).await {
        Ok(outcome) => view(ctx, inputs, outcome.plan, outcome.cached_at).map_err(RunError::App),
        Err(error) => Err(RunError::Claude(error)),
    };
    emit(match &result {
        Ok(view) => ClaudeTaskEvent::Done {
            result: view.clone(),
        },
        Err(error) => ClaudeTaskEvent::Failed {
            error: error.clone().into(),
        },
    });
    result
}

fn view(
    ctx: &Context<'_>,
    inputs: &SessionInputs,
    plan: Plan,
    cached_at: Option<String>,
) -> Result<PlanView, AppError> {
    let hunks = coverage::hunk_refs(&inputs.files);
    let order = ctx
        .store
        .with_conn(|conn| Ok(step_order::load(conn, &inputs.session_id, &plan, &hunks)))??;
    let stats = |ids: &[String]| change_stats(&inputs.files, ids);
    Ok(PlanView {
        step_stats: plan.steps.iter().map(|s| stats(&s.hunk_ids)).collect(),
        skim_stats: plan.skim.iter().map(|g| stats(&g.hunk_ids)).collect(),
        plan,
        cached_at,
        order,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::model::{FileStatus, Hunk, Line};
    use crate::review::layer::Layer;

    fn line(kind: LineKind) -> Line {
        Line {
            kind,
            old_no: None,
            new_no: None,
            text: String::new(),
            emphasis: Vec::new(),
            staged: None,
        }
    }

    fn file(path: &str, hunks: &[(&str, usize, usize)]) -> FileDiff {
        FileDiff {
            old_path: Some(path.into()),
            new_path: Some(path.into()),
            status: FileStatus::Modified,
            binary: false,
            mode_change: None,
            additions: 0,
            deletions: 0,
            layer: Layer::Other,
            hunks: hunks
                .iter()
                .map(|&(id, add, del)| Hunk {
                    id: id.into(),
                    old_start: 1,
                    old_lines: 1,
                    new_start: 1,
                    new_lines: 1,
                    header: String::new(),
                    lines: std::iter::repeat_n(line(LineKind::Add), add)
                        .chain(std::iter::repeat_n(line(LineKind::Del), del))
                        .chain([line(LineKind::Ctx)])
                        .collect(),
                    file_level: false,
                    staged_differs: false,
                    mechanical: None,
                })
                .collect(),
            line_staging: true,
        }
    }

    #[test]
    fn f06_3_row_stats_count_files_and_lines_of_the_steps_hunks() {
        let files = [
            file("src/Core/IUploadQueue.cs", &[("h1", 30, 0), ("h2", 8, 0)]),
            file("src/App/Zażółć/Upload ViewModel.cs", &[("h3", 18, 9)]),
            file("App.csproj", &[("h4", 1, 1)]),
        ];
        let ids = |list: &[&str]| list.iter().map(|&s| s.to_owned()).collect::<Vec<_>>();
        assert_eq!(
            change_stats(&files, &ids(&["h1", "h2", "h3"])),
            ChangeStats {
                files: 2,
                additions: 56,
                deletions: 9
            }
        );
        assert_eq!(
            change_stats(&files, &ids(&["h2", "nope"])),
            ChangeStats {
                files: 1,
                additions: 8,
                deletions: 0
            }
        );
        assert_eq!(change_stats(&files, &[]), ChangeStats::default());
    }
}
