//! `claude` (S1–S4 on the machine's Claude Code, field visit 1 on Claude Enterprise): sign-in
//! status, the startup probe, the read-only profile under `--restricted` (schema, system prompt
//! file, `--add-dir` input, repository read, loaded tools), canaries of project configuration,
//! `--resume`, schema enforcement, the fix profile in a scratch worktree, and model IDs.
//! About ten short calls; Haiku unless `--model` says otherwise. Synthetic fixtures only.

use std::path::Path;
use std::time::{Duration, Instant};

use guided_review_lib::claude::discover::{ClaudeExecutable, DiscoveryInput, discover};
use guided_review_lib::claude::result::{ClaudeResult, parse_result};
use guided_review_lib::claude::runner::{self, OutputFormat, Task};
use guided_review_lib::os::process::{self, Cancel};
use serde_json::{Value, json};

use crate::Args;
use crate::claude_fixture::{Fixture, SYSTEM_WORD};
use crate::claude_s3_s4::{canaries, fix_profile, schema_enforcement};
use crate::report::{Check, Detail, Outcome, Sanitizer, key_types, utc_now};

const TIMEOUT: Duration = Duration::from_secs(240);
const DEFAULT_MODEL: &str = "claude-haiku-5-5";
const MODELS: [&str; 4] = [
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "claude-fable-5-1",
];

/// One finished `claude` run.
pub struct Run {
    pub result: Option<ClaudeResult>,
    pub raw: Option<Value>,
    pub init: Option<Value>,
    pub exit: Option<i32>,
    pub ms: u128,
}

impl Run {
    pub fn ok(&self) -> bool {
        self.result.as_ref().is_some_and(|r| !r.is_error)
    }

    /// `ok`, `api_error_status:429`, `terminal_reason:max_turns`, `no_result`.
    fn code(&self) -> String {
        match &self.result {
            Some(r) if !r.is_error => "ok".into(),
            Some(r) => match (r.api_error_status, &r.terminal_reason) {
                (Some(status), _) => format!("api_error_status:{status}"),
                (None, Some(reason)) => format!("terminal_reason:{reason}"),
                _ => "is_error".into(),
            },
            None => format!(
                "no_result:exit_{}",
                self.exit.map_or("none".into(), |c| c.to_string())
            ),
        }
    }

    pub fn structured(&self, key: &str) -> Option<&Value> {
        self.result.as_ref()?.structured_output.as_ref()?.get(key)
    }

    pub fn check(&self, id: &str) -> Check {
        Check::new(
            id,
            if self.ok() {
                Outcome::Pass
            } else {
                Outcome::Fail
            },
        )
        .detail(Detail::Code(self.code()))
        .ms(self.ms)
    }
}

pub async fn claude(
    exe: &ClaudeExecutable,
    args: Vec<std::ffi::OsString>,
    cwd: &Path,
    prompt: &str,
) -> Run {
    let spec = runner::process_spec(exe, args, cwd, Some(prompt), TIMEOUT);
    let started = Instant::now();
    let output = process::run(&spec, &Cancel::new()).await;
    let ms = started.elapsed().as_millis();
    let Ok(output) = output else {
        return Run {
            result: None,
            raw: None,
            init: None,
            exit: None,
            ms,
        };
    };
    let init = output.stdout.lines().find_map(|line| {
        let event: Value = serde_json::from_str(line).ok()?;
        (event.get("type")? == "system" && event.get("subtype")? == "init").then_some(event)
    });
    let parsed = parse_result(&output.stdout);
    Run {
        result: parsed.as_ref().map(|(r, _)| r.clone()),
        raw: parsed.map(|(_, raw)| raw),
        init,
        exit: output.code,
        ms,
    }
}

pub fn task(fixture: &Fixture, model: &str, output: OutputFormat, schema: Option<Value>) -> Task {
    Task {
        output,
        json_schema: schema.map(|s| s.to_string()),
        model: Some(model.to_owned()),
        effort: None,
        system_prompt_file: fixture.task.join("system-common.md"),
        task_dir: fixture.task.clone(),
        persist_session: false,
        resume: None,
    }
}

pub async fn run(args: &Args) -> Result<(Vec<Check>, Sanitizer), String> {
    let exe =
        discover(&DiscoveryInput::from_env(None)).ok_or("Claude Code was not found (ADR-021)")?;
    let model = args.option("model").unwrap_or(DEFAULT_MODEL).to_owned();
    let stamp: String = utc_now().chars().filter(char::is_ascii_digit).collect();
    let fixture = Fixture::create(&stamp).await?;
    let mut checks = auth_status(&exe).await;
    let probe = claude(
        &exe,
        runner::probe_args(Some(&model)),
        &std::env::temp_dir(),
        runner::PROBE_PROMPT,
    )
    .await;
    checks.push(probe.check("startup_probe"));
    if let Some(raw) = &probe.raw {
        checks
            .push(Check::new("result.keys", Outcome::Info).detail(Detail::Keys(key_types(raw, 1))));
    }
    let restricted_ok = read_only(&exe, &fixture, &model, &mut checks).await;
    checks.extend(canaries(&exe, &fixture, &model).await);
    if !restricted_ok {
        // ADR-022 fallback: is the same isolation available without --restricted?
        let t = task(
            &fixture,
            &model,
            OutputFormat::Json,
            Some(read_only_schema()),
        );
        let run = claude(
            &exe,
            runner::restricted_fallback_args(&t),
            &fixture.teammate,
            &read_only_prompt(&fixture),
        )
        .await;
        checks.push(run.check("s2_fallback.read_only"));
    }
    checks.push(schema_enforcement(&exe, &fixture, &model).await);
    checks.extend(fix_profile(&exe, &fixture, &model).await);
    for id in MODELS {
        let run = claude(
            &exe,
            runner::probe_args(Some(id)),
            &std::env::temp_dir(),
            runner::PROBE_PROMPT,
        )
        .await;
        checks.push(run.check(&format!("model.{id}")));
    }
    let markers = fixture.markers_found();
    checks.push(
        Check::new(
            "s3.project_hooks_and_mcp_ran",
            if markers.is_empty() {
                Outcome::Pass
            } else {
                Outcome::Fail
            },
        )
        .detail(Detail::Names(markers)),
    );
    fixture.remove().await;
    Ok((checks, Sanitizer::from_env()))
}

/// `claude auth status`: only `loggedIn`, `authMethod`, `apiProvider`, `subscriptionType`.
async fn auth_status(exe: &ClaudeExecutable) -> Vec<Check> {
    let spec = runner::process_spec(
        exe,
        runner::auth_status_args(),
        &std::env::temp_dir(),
        None,
        TIMEOUT,
    );
    let Ok(output) = process::run(&spec, &Cancel::new()).await else {
        return vec![Check::new("auth_status", Outcome::Fail)];
    };
    let Ok(status) = serde_json::from_str::<Value>(output.stdout.trim()) else {
        return vec![
            Check::new("auth_status", Outcome::Fail).detail(Detail::Code("not_json".into())),
        ];
    };
    let logged_in = status
        .get("loggedIn")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut checks = vec![
        Check::new(
            "auth_status.logged_in",
            if logged_in {
                Outcome::Pass
            } else {
                Outcome::Fail
            },
        )
        .detail(Detail::Bool(logged_in)),
    ];
    for key in ["authMethod", "apiProvider", "subscriptionType"] {
        if let Some(value) = status.get(key).and_then(Value::as_str) {
            checks.push(
                Check::new(&format!("auth_status.{key}"), Outcome::Info)
                    .detail(Detail::Code(value.into())),
            );
        }
    }
    let keys: Vec<String> = status
        .as_object()
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    checks.push(Check::new("auth_status.keys", Outcome::Info).detail(Detail::Names(keys)));
    checks
}

fn read_only_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "repo_value": { "type": "string" },
            "input_value": { "type": "string" },
            "system_word": { "type": "string" }
        },
        "required": ["repo_value", "input_value", "system_word"],
        "additionalProperties": false
    })
}

fn read_only_prompt(fixture: &Fixture) -> String {
    format!(
        "Read src/Canary.cs in the current directory and put the value of the constant Value into repo_value. Read the file {} and put the code it contains into input_value. Put the system word from your system instructions into system_word. Open no other files.",
        fixture.task.join("input.md").display()
    )
}

/// S1/S2: the read-only profile under `--restricted` with stream-json, a schema, the system
/// prompt file and an `--add-dir` input; then `--resume`. Returns whether it worked.
async fn read_only(
    exe: &ClaudeExecutable,
    fixture: &Fixture,
    model: &str,
    checks: &mut Vec<Check>,
) -> bool {
    let mut t = task(
        fixture,
        model,
        OutputFormat::StreamJson,
        Some(read_only_schema()),
    );
    t.persist_session = true;
    let run = claude(
        exe,
        runner::read_only_args(&t),
        &fixture.teammate,
        &read_only_prompt(fixture),
    )
    .await;
    checks.push(run.check("s1.read_only_restricted"));
    let text = |key: &str| {
        run.structured(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    for (id, ok) in [
        (
            "s1.reads_repository",
            text("repo_value") == fixture.repo_canary,
        ),
        (
            "s1.reads_add_dir_input",
            text("input_value") == fixture.input_canary,
        ),
        (
            "s1.system_prompt_file_applied",
            text("system_word") == SYSTEM_WORD,
        ),
        (
            "s1.no_permission_denials",
            run.result
                .as_ref()
                .is_some_and(|r| r.permission_denials.is_empty()),
        ),
    ] {
        checks.push(
            Check::new(id, if ok { Outcome::Pass } else { Outcome::Fail }).detail(Detail::Bool(ok)),
        );
    }
    if let Some(init) = &run.init {
        checks.extend(init_checks(
            "s1.init",
            init,
            &["Glob", "Grep", "Read", "StructuredOutput"],
        ));
    }
    let Some(session) = run.result.as_ref().and_then(|r| r.session_id.clone()) else {
        return run.ok();
    };
    let mut follow = task(
        fixture,
        model,
        OutputFormat::StreamJson,
        Some(json!({
            "type": "object", "properties": { "repo_value": { "type": "string" } },
            "required": ["repo_value"], "additionalProperties": false
        })),
    );
    follow.persist_session = true;
    follow.resume = Some(session.clone());
    let resumed = claude(
        exe,
        runner::read_only_args(&follow),
        &fixture.teammate,
        "What was repo_value in your previous answer? Do not open any file.",
    )
    .await;
    checks.push(resumed.check("s1.resume"));
    let same_session = resumed
        .result
        .as_ref()
        .and_then(|r| r.session_id.as_deref())
        == Some(session.as_str());
    let remembered = resumed.structured("repo_value").and_then(Value::as_str)
        == Some(fixture.repo_canary.as_str());
    checks.push(
        Check::new("s1.resume_same_session", Outcome::Info).detail(Detail::Bool(same_session)),
    );
    checks.push(Check::new("s1.resume_remembers", Outcome::Info).detail(Detail::Bool(remembered)));
    run.ok()
}

/// Tools (with `--json-schema` Claude Code adds its internal `StructuredOutput` tool), MCP
/// servers, plugins, skills, agents and memory files of the session (counts only:
/// plugin names could reveal company tooling).
pub fn init_checks(prefix: &str, init: &Value, expected_tools: &[&str]) -> Vec<Check> {
    let names = |key: &str| -> Vec<String> {
        init.get(key)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        item.as_str()
                            .or_else(|| item.get("name").and_then(Value::as_str))
                    })
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut tools = names("tools");
    tools.sort();
    let tools_ok = tools == expected_tools;
    let mut checks = vec![
        Check::new(
            &format!("{prefix}.tools"),
            if tools_ok {
                Outcome::Pass
            } else {
                Outcome::Fail
            },
        )
        .detail(Detail::Names(tools)),
    ];
    for key in ["mcp_servers", "plugins", "skills", "agents", "memory_paths"] {
        let count = init.get(key).map_or(0, |v| {
            v.as_array()
                .map_or_else(|| v.as_object().map_or(0, |o| o.len()), Vec::len)
        });
        checks.push(
            Check::new(&format!("{prefix}.{key}_count"), Outcome::Info)
                .detail(Detail::Number(i64::try_from(count).unwrap_or(-1))),
        );
    }
    checks
}
