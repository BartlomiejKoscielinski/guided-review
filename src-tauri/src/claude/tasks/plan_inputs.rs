//! The input files of the plan task (`prompts/plan.md`, docs/claude/README.md): the source
//! label and block, the hunk index, the full diff, the mechanical hunks (F-05.5) and the
//! description and rules ("none" when absent). The threads file is `gitlab::discussions::render`.

use crate::claude::result::clamp;
use crate::git::model::{FileDiff, FileStatus, Hunk, LineKind};
use crate::review::layer::Layer;
use crate::review::mechanical::MechanicalReason;
use crate::source::model::{LocalScope, Source};

/// A changed line in the hunk index is clamped to this many characters.
const FIRST_LINE_MAX: usize = 100;

/// What is being reviewed: a teammate's MR, commits, or the user's own local changes (F-17.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanSource {
    Mr {
        iid: u64,
        title: String,
        source_branch: String,
        target_branch: String,
    },
    /// A single commit (`from` absent, against its first parent) or `from..to` (SHAs).
    Commits { from: Option<String>, to: String },
    /// The user's own changes in the repository root (no worktree).
    Local { scope: LocalScope },
}

fn short(sha: &str) -> &str {
    sha.get(..7).unwrap_or(sha)
}

impl PlanSource {
    /// `{{source_label}}`: `merge request !482 "Title" (feature/x → develop)`, `commit 1a2b3c4`,
    /// `commits 1a2b3c4..5d6e7f8` or the user's own changes in one scope.
    pub fn label(&self) -> String {
        match self {
            Self::Mr {
                iid,
                title,
                source_branch,
                target_branch,
            } => format!("merge request !{iid} \"{title}\" ({source_branch} → {target_branch})"),
            Self::Commits { from: None, to } => format!("commit {}", short(to)),
            Self::Commits {
                from: Some(from),
                to,
            } => {
                format!("commits {}..{}", short(from), short(to))
            }
            Self::Local { scope } => match scope {
                LocalScope::Uncommitted => "the author's own uncommitted changes".to_owned(),
                LocalScope::Staged => "the author's own staged changes".to_owned(),
                LocalScope::BranchVsTarget { target } => {
                    format!("the author's own branch against {target}")
                }
            },
        }
    }

    /// `{{source_block}}`: the commits or tree states the diff lies between.
    pub fn block(&self, base_sha: &str, head_sha: &str) -> String {
        match self {
            Self::Mr { target_branch, .. } => format!(
                "The diff runs from the merge base with {target_branch} ({base_sha}) to the MR head ({head_sha})."
            ),
            Self::Commits { from: None, .. } => format!(
                "The diff runs from the commit's first parent ({base_sha}) to the commit ({head_sha})."
            ),
            Self::Commits { from: Some(_), .. } => format!(
                "The diff runs from {base_sha} (not included) to {head_sha}, every commit in between."
            ),
            Self::Local { scope } => match scope {
                LocalScope::Uncommitted => format!(
                    "The diff runs from HEAD ({base_sha}) to the working tree: staged, unstaged and untracked changes not committed yet."
                ),
                LocalScope::Staged => format!(
                    "The diff runs from HEAD ({base_sha}) to the index: only the staged changes; the working tree may hold more unstaged edits."
                ),
                LocalScope::BranchVsTarget { target } => format!(
                    "The diff runs from the merge base with {target} ({base_sha}) to HEAD ({head_sha}); the working tree may hold uncommitted edits on top."
                ),
            },
        }
    }

    /// `claude_cache.subject` (docs/04, migration 004), one per source.
    pub fn subject(&self) -> String {
        match self {
            Self::Mr { iid, .. } => crate::review::plan_cache::mr_subject(*iid),
            Self::Commits { from, to } => crate::review::plan_cache::subject(&Source::Commits {
                from: from.clone(),
                to: to.clone(),
            }),
            Self::Local { scope } => crate::review::plan_cache::subject(&Source::Local {
                scope: scope.clone(),
            }),
        }
    }
}

fn path(file: &FileDiff) -> &str {
    file.new_path
        .as_deref()
        .or(file.old_path.as_deref())
        .unwrap_or_default()
}

/// The layer names of `plan.schema.json`.
pub fn layer_name(layer: Layer) -> &'static str {
    match layer {
        Layer::Core => "Core",
        Layer::Infrastructure => "Infrastructure",
        Layer::App => "App",
        Layer::Xaml => "XAML",
        Layer::Platforms => "Platforms",
        Layer::Tests => "Tests",
        Layer::Resources => "Resources",
        Layer::Build => "Build",
        Layer::Other => "Other",
    }
}

fn counts(hunk: &Hunk) -> (usize, usize) {
    let count = |kind| hunk.lines.iter().filter(|l| l.kind == kind).count();
    (count(LineKind::Add), count(LineKind::Del))
}

fn file_change(file: &FileDiff) -> String {
    let mut parts = vec![file.status.as_str().to_owned()];
    if let (Some(old), Some(new)) = (&file.old_path, &file.new_path)
        && old != new
    {
        parts.push(format!("from {old}"));
    }
    if file.binary {
        parts.push("binary".to_owned());
    }
    if let Some(mode) = &file.mode_change {
        parts.push(format!("mode {mode}"));
    }
    format!("(file {})", parts.join(", "))
}

/// One line per hunk: `hunk_id, file, layer guess, +/-, first changed line` (tab separated).
pub fn hunk_index(files: &[FileDiff]) -> String {
    let mut out = String::from("# hunk_id\tfile\tlayer\t+added/-removed\tfirst changed line\n");
    for file in files {
        for hunk in &file.hunks {
            let (added, removed) = counts(hunk);
            let first = if hunk.file_level {
                file_change(file)
            } else {
                hunk.lines
                    .iter()
                    .find(|l| l.kind != LineKind::Ctx)
                    .map(|l| {
                        let (side, number) = match l.kind {
                            LineKind::Del => ("old", l.old_no),
                            _ => ("new", l.new_no),
                        };
                        let text =
                            clamp(l.text.trim_end_matches(['\r', '\n']).trim(), FIRST_LINE_MAX);
                        format!("{side} {}: {text}", number.unwrap_or_default())
                    })
                    .unwrap_or_default()
            };
            out.push_str(&format!(
                "{}\t{}\t{}\t+{added}/-{removed}\t{first}\n",
                hunk.id,
                path(file),
                layer_name(file.layer)
            ));
        }
    }
    out
}

/// The full diff in unified form, each hunk header followed by its ID.
pub fn diff_text(files: &[FileDiff]) -> String {
    let mut out = String::new();
    for file in files {
        let new = path(file);
        let old = file.old_path.as_deref().unwrap_or(new);
        out.push_str(&format!("diff --git a/{old} b/{new}\n"));
        let change = file_change(file);
        if file.status != FileStatus::Modified || file.binary || file.mode_change.is_some() {
            out.push_str(&format!("# {change}\n"));
        }
        for hunk in &file.hunks {
            if hunk.file_level {
                out.push_str(&format!("# hunk {} (no text changes)\n", hunk.id));
                continue;
            }
            out.push_str(&format!(
                "@@ -{},{} +{},{} @@ {}\n# hunk {}\n",
                hunk.old_start,
                hunk.old_lines,
                hunk.new_start,
                hunk.new_lines,
                hunk.header,
                hunk.id
            ));
            for line in &hunk.lines {
                let sign = match line.kind {
                    LineKind::Ctx => ' ',
                    LineKind::Add => '+',
                    LineKind::Del => '-',
                };
                out.push(sign);
                out.push_str(line.text.trim_end_matches(['\r', '\n']));
                out.push('\n');
            }
        }
    }
    out
}

fn reason_name(reason: MechanicalReason) -> &'static str {
    match reason {
        MechanicalReason::Generated => "generated",
        MechanicalReason::Whitespace => "whitespace only",
        MechanicalReason::PackageBump => "package bump",
        MechanicalReason::ResxKeyAdded => "resx key added",
    }
}

/// `mechanical_file`: `hunk_id, file, reason` for every hunk with `Hunk.mechanical`, or "none".
pub fn mechanical_file(files: &[FileDiff]) -> String {
    let lines: Vec<String> = files
        .iter()
        .flat_map(|f| {
            f.hunks.iter().filter_map(move |h| {
                h.mechanical
                    .map(|r| format!("{}\t{}\t{}\n", h.id, path(f), reason_name(r)))
            })
        })
        .collect();
    if lines.is_empty() {
        "none\n".to_owned()
    } else {
        format!("# hunk_id\tfile\treason\n{}", lines.concat())
    }
}

/// A text input, or "none" when it is missing or blank.
pub fn or_none(text: Option<&str>) -> String {
    match text.map(str::trim).filter(|t| !t.is_empty()) {
        Some(text) => format!("{text}\n"),
        None => "none\n".to_owned(),
    }
}

#[cfg(test)]
#[path = "plan_inputs_tests.rs"]
mod tests;
