//! Config-change risk without AI (F-06.13): a change that touches review or Claude
//! configuration gets an orange risk at the top of Risks to check, also when Claude isn't
//! available. Matched at any depth, because Claude Code also reads nested `CLAUDE.md` files.

use std::collections::HashSet;

use super::plan_model::{Plan, Risk, RiskSeverity, Step};
use crate::git::model::FileDiff;

const CONFIG_FILES: [&str; 3] = ["claude.md", "agents.md", ".mcp.json"];
const CONFIG_FOLDERS: [&str; 2] = [".claude", ".review"];

/// Whether a repository-relative path is review or Claude configuration (case-insensitive).
pub fn is_config_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    let mut parts: Vec<&str> = lower.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    let name = parts.pop().unwrap_or_default();
    CONFIG_FILES.contains(&name) || parts.iter().any(|f| CONFIG_FOLDERS.contains(f))
}

/// The risk for the change's config paths (old and new paths, diff order), pointing at the
/// steps that hold their hunks; `None` when no config file changed.
pub fn config_risk(files: &[FileDiff], steps: &[Step]) -> Option<Risk> {
    let mut paths: Vec<&str> = Vec::new();
    let mut hunks: HashSet<&str> = HashSet::new();
    for file in files {
        let matched: Vec<&str> = [file.old_path.as_deref(), file.new_path.as_deref()]
            .into_iter()
            .flatten()
            .filter(|p| is_config_path(p))
            .collect();
        if matched.is_empty() {
            continue;
        }
        for path in matched {
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
        hunks.extend(file.hunks.iter().map(|h| h.id.as_str()));
    }
    if paths.is_empty() {
        return None;
    }
    Some(Risk {
        text: format!(
            "This MR changes review or Claude configuration: {}",
            paths.join(", ")
        ),
        severity: RiskSeverity::Fix,
        steps: steps
            .iter()
            .filter(|s| s.hunk_ids.iter().any(|id| hunks.contains(id.as_str())))
            .map(|s| s.id.clone())
            .collect(),
        app: true,
    })
}

/// Puts the config risk first in the plan's risks, replacing an earlier app risk.
pub fn add_config_risk(plan: &mut Plan, files: &[FileDiff]) {
    plan.risks.retain(|r| !r.app);
    if let Some(risk) = config_risk(files, &plan.steps) {
        plan.risks.insert(0, risk);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::model::{FileStatus, Hunk};
    use crate::review::layer::Layer;
    use crate::review::plan_model::{Coverage, Orders};

    fn hunk(id: &str) -> Hunk {
        Hunk {
            id: id.into(),
            old_start: 1,
            old_lines: 1,
            new_start: 1,
            new_lines: 1,
            header: String::new(),
            lines: Vec::new(),
            file_level: false,
            staged_differs: false,
            mechanical: None,
        }
    }

    fn file(old: Option<&str>, new: Option<&str>, hunk_id: &str) -> FileDiff {
        FileDiff {
            old_path: old.map(Into::into),
            new_path: new.map(Into::into),
            status: FileStatus::Modified,
            binary: false,
            mode_change: None,
            additions: 1,
            deletions: 1,
            layer: Layer::Other,
            hunks: vec![hunk(hunk_id)],
            line_staging: true,
        }
    }

    fn step(id: &str, hunk_ids: &[&str]) -> Step {
        Step {
            id: id.into(),
            title: id.into(),
            short_title: id.into(),
            reason: String::new(),
            description: String::new(),
            layer: Layer::Other,
            hunk_ids: hunk_ids.iter().map(|&h| h.into()).collect(),
            builds_on: Vec::new(),
        }
    }

    #[test]
    fn f06_13_config_paths_match_files_and_folders_at_any_depth() {
        let yes = [
            "CLAUDE.md",
            "src/App/CLAUDE.md",
            "claude.md",
            "AGENTS.md",
            ".claude/settings.json",
            ".claude/agents/reviewer.md",
            "tools\\.claude\\commands\\ship.md",
            ".mcp.json",
            ".review/rules.md",
            "src/Ąę Moduł/.review/rules.md",
        ];
        let no = [
            "README.md",
            "docs/CLAUDE.md.bak",
            "src/claude/runner.rs",
            "src/App/Agents.cs",
            "mcp.json",
            "docs/review/notes.md",
            ".claudeignore",
        ];
        for path in yes {
            assert!(is_config_path(path), "{path}");
        }
        for path in no {
            assert!(!is_config_path(path), "{path}");
        }
    }

    #[test]
    fn f06_13_risk_lists_paths_and_points_at_their_steps() {
        let files = [
            file(Some("src/App/Login.cs"), Some("src/App/Login.cs"), "h1"),
            file(Some("CLAUDE.md"), Some("CLAUDE.md"), "h2"),
            file(Some("old/AGENTS.md"), Some(".review/rules.md"), "h3"),
            file(Some(".mcp.json"), None, "h4"),
        ];
        let steps = [
            step("s1", &["h1"]),
            step("s2", &["h2", "h3"]),
            step("s3", &["h4"]),
        ];
        let risk = config_risk(&files, &steps).unwrap();
        assert_eq!(
            risk.text,
            "This MR changes review or Claude configuration: CLAUDE.md, old/AGENTS.md, \
             .review/rules.md, .mcp.json"
        );
        assert_eq!(risk.severity, RiskSeverity::Fix);
        assert!(risk.app);
        assert_eq!(risk.steps, ["s2", "s3"]);
    }

    #[test]
    fn f06_13_no_config_change_means_no_risk() {
        let files = [file(
            Some("src/App/Login.cs"),
            Some("src/App/Login.cs"),
            "h1",
        )];
        assert_eq!(config_risk(&files, &[]), None);
    }

    #[test]
    fn f06_13_without_claude_the_risk_has_no_steps() {
        let files = [file(None, Some(".claude/settings.json"), "h1")];
        let risk = config_risk(&files, &[]).unwrap();
        assert!(risk.steps.is_empty());
        assert!(risk.text.ends_with(": .claude/settings.json"));
    }

    #[test]
    fn f06_13_config_risk_goes_first_and_replaces_an_earlier_one() {
        let claude_risk = Risk {
            text: "Retry can upload twice.".into(),
            severity: RiskSeverity::Q,
            steps: vec!["s1".into()],
            app: false,
        };
        let mut plan = Plan {
            intent: String::new(),
            steps: vec![step("s1", &["h1"])],
            orders: Orders::default(),
            skim: Vec::new(),
            risks: vec![claude_risk.clone()],
            description_check: Vec::new(),
            already_discussed: String::new(),
            coverage: Coverage::default(),
        };
        let files = [file(Some("AGENTS.md"), Some("AGENTS.md"), "h1")];
        add_config_risk(&mut plan, &files);
        add_config_risk(&mut plan, &files);
        assert_eq!(plan.risks.len(), 2);
        assert!(plan.risks[0].app);
        assert_eq!(plan.risks[0].steps, ["s1"]);
        assert_eq!(plan.risks[1], claude_risk);
        add_config_risk(&mut plan, &[]);
        assert_eq!(plan.risks, [claude_risk]);
    }
}
