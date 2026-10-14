//! The plan of a session with its channel events (`review_plan`, docs/04 › IPC contract):
//! `queued`, `started` unless cached, then `done` with the plan and the session's step order
//! (F-06.2, F-06.12). When Claude fails or isn't signed in, `done` carries the app's fallback
//! plan (`plan_fallback.rs`) with the error; `failed` only when cancelled or the app failed.
//! A cached plan starts no `claude` process. The plan in `done` is kept as the session's plan
//! (`plans.plan_json`): its "Pick up where you left off" card counts these steps (F-04.1).

use std::collections::HashSet;

use serde::Serialize;
use ts_rs::TS;

use super::coverage;
use super::plan_fallback;
use super::plan_model::Plan;
use super::step_context::SessionInputs;
use super::step_order::{self, StepOrder};
use super::step_runs::RunError;
use crate::claude::ClaudeError;
use crate::claude::tasks::events::ClaudeTaskEvent;
use crate::claude::tasks::plan::{self, Context};
use crate::error::AppError;
use crate::git::model::{FileDiff, LineKind};
use crate::gitlab::discussions::Thread;
use crate::os::process::Cancel;
use crate::store::{Store, plans};

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
    /// The paths of each skim group's files for **Show** (F-06.6), in the order of `plan.skim`.
    pub skim_files: Vec<Vec<String>>,
    /// The plan's steps marked reviewed in this session, in plan order (F-07.1 done checks and
    /// progress segments); `review_mark_step` returns the new list.
    pub reviewed: Vec<String>,
    /// Why Claude couldn't plan (S-02 Claude failed): the plan is then the app's file-order
    /// fallback, one step per layer group in GitLab file order, with config risks (F-06.13),
    /// "N open threads." and coverage; no intent, orders, skim or claims. Never cached.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fallback: Option<AppError>,
}

/// Claude Code can't run at all (not found): the fallback view right away, `queued` → `done`.
pub fn unavailable(
    store: &Store,
    inputs: &SessionInputs,
    error: ClaudeError,
    emit: &(dyn Fn(ClaudeTaskEvent<PlanView>) + Sync),
) -> Planned {
    emit(ClaudeTaskEvent::Queued);
    let view = fallback_view(&inputs.files, &inputs.threads, &error);
    plans::keep_plan(store, &inputs.session_id, &view.plan);
    emit(ClaudeTaskEvent::Done {
        result: view.clone(),
    });
    Planned {
        view,
        claude_error: Some(error),
    }
}

/// The plan task's result: the view, and the Claude error behind a fallback view.
#[derive(Debug, Clone)]
pub struct Planned {
    pub view: PlanView,
    pub claude_error: Option<ClaudeError>,
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

/// The paths of the files that `hunk_ids` touch, in diff order; unknown IDs add nothing.
pub fn hunk_paths(files: &[FileDiff], hunk_ids: &[String]) -> Vec<String> {
    let wanted: HashSet<&str> = hunk_ids.iter().map(String::as_str).collect();
    files
        .iter()
        .filter(|f| f.hunks.iter().any(|h| wanted.contains(h.id.as_str())))
        .filter_map(|f| f.new_path.clone().or_else(|| f.old_path.clone()))
        .collect()
}

/// Plans the session (or reads the cached plan) and emits the task events. On a Claude error
/// other than a cancel, the result is the fallback view and `claude_error` says why.
pub async fn plan(
    ctx: &Context<'_>,
    inputs: &SessionInputs,
    cancel: &Cancel,
    emit: &(dyn Fn(ClaudeTaskEvent<PlanView>) + Sync),
) -> Result<Planned, RunError> {
    emit(ClaudeTaskEvent::Queued);
    let started = || emit(ClaudeTaskEvent::Started);
    let result = match plan::run(ctx, &inputs.plan_request(), &started, cancel).await {
        Ok(outcome) => view(ctx, inputs, outcome.plan, outcome.cached_at)
            .map(|view| Planned {
                view,
                claude_error: None,
            })
            .map_err(RunError::App),
        Err(ClaudeError::Cancelled) => Err(RunError::Claude(ClaudeError::Cancelled)),
        Err(error) => Ok(Planned {
            view: fallback_view(&inputs.files, &inputs.threads, &error),
            claude_error: Some(error),
        }),
    };
    if let Ok(planned) = &result {
        plans::keep_plan(ctx.store, &inputs.session_id, &planned.view.plan);
    }
    emit(match &result {
        Ok(planned) => ClaudeTaskEvent::Done {
            result: planned.view.clone(),
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
    Ok(assemble(&inputs.files, plan, order, cached_at, None))
}

/// S-02 without Claude: the fallback plan in File order, never cached, its order not stored.
pub fn fallback_view(files: &[FileDiff], threads: &[Thread], error: &ClaudeError) -> PlanView {
    let plan = plan_fallback::plan(files, threads);
    let order = step_order::fallback(&plan);
    assemble(files, plan, order, None, Some(error.clone().into()))
}

fn assemble(
    files: &[FileDiff],
    plan: Plan,
    order: StepOrder,
    cached_at: Option<String>,
    fallback: Option<AppError>,
) -> PlanView {
    let stats = |ids: &[String]| change_stats(files, ids);
    PlanView {
        step_stats: plan.steps.iter().map(|s| stats(&s.hunk_ids)).collect(),
        skim_stats: plan.skim.iter().map(|g| stats(&g.hunk_ids)).collect(),
        skim_files: plan
            .skim
            .iter()
            .map(|g| hunk_paths(files, &g.hunk_ids))
            .collect(),
        plan,
        cached_at,
        order,
        reviewed: Vec::new(),
        fallback,
    }
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

    #[test]
    fn f06_6_skim_show_lists_the_paths_of_the_groups_files() {
        let files = [
            file("src/Core/IUploadQueue.cs", &[("h1", 30, 0), ("h2", 8, 0)]),
            file("src/App/Zażółć/Upload ViewModel.cs", &[("h3", 18, 9)]),
        ];
        let ids = |list: &[&str]| list.iter().map(|&s| s.to_owned()).collect::<Vec<_>>();
        assert_eq!(
            hunk_paths(&files, &ids(&["h3", "h2", "nope"])),
            [
                "src/Core/IUploadQueue.cs",
                "src/App/Zażółć/Upload ViewModel.cs"
            ]
        );
        assert!(hunk_paths(&files, &[]).is_empty());
    }
}
