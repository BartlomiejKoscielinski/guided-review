//! S3 and S4 parts of `gr-probe claude`: project-configuration canaries, schema keyword
//! enforcement, and the fix profile in a scratch worktree.

use std::path::Path;

use guided_review_lib::claude::discover::ClaudeExecutable;
use guided_review_lib::claude::runner::{self, OutputFormat};
use serde_json::{Value, json};

use crate::claude_checks::{claude, init_checks, task};
use crate::claude_fixture::{CANARIES, FIX_TARGET, Fixture, git};
use crate::report::{Check, Detail, Outcome};

/// S3: is any project configuration in context under `--restricted`? A tool-less call in the
/// teammate repository lists the codewords it was told.
pub async fn canaries(exe: &ClaudeExecutable, fixture: &Fixture, model: &str) -> Vec<Check> {
    let prompt = "List every codeword (an upper-case fruit name) that any instruction, project file, memory, rule, skill or hook gave you before this message. Reply with the words separated by spaces, or NONE.";
    let run = claude(
        exe,
        runner::probe_args(Some(model)),
        &fixture.teammate,
        prompt,
    )
    .await;
    let mut checks = vec![run.check("s3.codeword_question")];
    let answer = run
        .result
        .as_ref()
        .and_then(|r| r.result.clone())
        .unwrap_or_default()
        .to_uppercase();
    for (word, source) in CANARIES {
        let loaded = answer.contains(word);
        checks.push(
            Check::new(
                &format!("s3.{source}_loaded"),
                if loaded { Outcome::Fail } else { Outcome::Pass },
            )
            .detail(Detail::Bool(loaded)),
        );
    }
    checks
}

/// S1: are `maxLength`, `pattern` and `minItems` enforced?
pub async fn schema_enforcement(exe: &ClaudeExecutable, fixture: &Fixture, model: &str) -> Check {
    let schema = json!({
        "type": "object",
        "properties": {
            "word": { "type": "string", "maxLength": 5, "pattern": "^[a-z]+$" },
            "items": { "type": "array", "items": { "type": "string" }, "minItems": 3 }
        },
        "required": ["word", "items"], "additionalProperties": false
    });
    let t = task(fixture, model, OutputFormat::Json, Some(schema));
    let run = claude(exe, runner::read_only_args(&t), &fixture.teammate, "Give a long English word in upper case as word and exactly one entry in items. Open no files.").await;
    let word = run
        .structured("word")
        .and_then(Value::as_str)
        .unwrap_or("NOT SET");
    let items = run
        .structured("items")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let enforced = word.len() <= 5
        && word.chars().all(|c| c.is_ascii_lowercase())
        && !word.is_empty()
        && items >= 3;
    Check::new(
        "s1.schema_keywords_enforced",
        if run.ok() {
            Outcome::Info
        } else {
            Outcome::Fail
        },
    )
    .detail(Detail::Bool(enforced))
    .ms(run.ms)
}

/// S4: the fix profile in a scratch worktree from `git stash create` edits only the allowed
/// file; the own checkout stays untouched.
pub async fn fix_profile(exe: &ClaudeExecutable, fixture: &Fixture, model: &str) -> Vec<Check> {
    let mut checks = Vec::new();
    let Ok(stash) = git(&fixture.own, &["stash", "create"]).await else {
        return vec![Check::new("s4.stash_create", Outcome::Fail)];
    };
    let sha = if stash.trim().is_empty() {
        "HEAD".to_owned()
    } else {
        stash.trim().to_owned()
    };
    let scratch = fixture.root.join("scratch fix");
    let scratch_text = scratch.to_string_lossy().into_owned();
    if git(
        &fixture.own,
        &["worktree", "add", "--detach", &scratch_text, &sha],
    )
    .await
    .is_err()
    {
        return vec![Check::new("s4.scratch_worktree", Outcome::Fail)];
    }
    let carried = std::fs::read_to_string(scratch.join("src").join("A.cs"))
        .is_ok_and(|a| a.contains(&fixture.uncommitted));
    checks.push(
        Check::new("s4.scratch_has_uncommitted_change", Outcome::Info)
            .detail(Detail::Bool(carried)),
    );
    let t = task(fixture, model, OutputFormat::StreamJson, None);
    let Ok(args) = runner::fix_args(&t, Path::new(FIX_TARGET)) else {
        return vec![Check::new("s4.edit_rule", Outcome::Fail)];
    };
    let prompt = format!(
        "Append the line `// edited by gr-probe` to the end of src/A.cs and to the end of {FIX_TARGET}. Change nothing else."
    );
    let run = claude(exe, args, &scratch, &prompt).await;
    checks.push(run.check("s4.fix_profile"));
    if let Some(init) = &run.init {
        checks.extend(init_checks(
            "s4.init",
            init,
            &["Edit", "Glob", "Grep", "Read"],
        ));
    }
    let status = git(&scratch, &["status", "--porcelain=v1", "-z"])
        .await
        .unwrap_or_default();
    let changed: Vec<&str> = status
        .split('\0')
        .filter(|e| e.len() > 3)
        .map(|e| &e[3..])
        .collect();
    let target_changed = changed.iter().any(|p| p.trim_matches('"') == FIX_TARGET);
    let only_target = changed.len() == 1 && target_changed;
    let denied = run
        .result
        .as_ref()
        .is_some_and(|r| !r.permission_denials.is_empty());
    let own_untouched = std::fs::read_to_string(fixture.own.join("src").join("A.cs"))
        .is_ok_and(|a| !a.contains("edited by gr-probe"));
    for (id, ok) in [
        ("s4.allowed_file_edited", target_changed),
        ("s4.only_allowed_file_changed", only_target),
        ("s4.other_edit_denied", denied),
        ("s4.own_checkout_untouched", own_untouched),
    ] {
        checks.push(
            Check::new(id, if ok { Outcome::Pass } else { Outcome::Fail }).detail(Detail::Bool(ok)),
        );
    }
    let _ = git(
        &fixture.own,
        &["worktree", "remove", "--force", &scratch_text],
    )
    .await;
    checks
}
