//! `gitlab write --project <sandbox>` (S5 write, field visit 1): in a sandbox project only, and
//! only after a "y" before each call. Creates two branches with a synthetic C# file, a draft MR
//! between them with the user as reviewer, positioned draft notes on an added, a deleted and a
//! context line plus one without position, publishes them in bulk (also with a summary `note`),
//! approves with a stale SHA and the head SHA, unapproves, runs an MR pipeline with a manual
//! job, plays it with a variable, cancels it, and closes the MR. Nothing is deleted.

use std::io::{BufRead, Write};

use serde_json::{Value, json};

use crate::Args;
use crate::gitlab_read::{Session, connect, keys_check, status_check};
use crate::gitlab_write_steps::{approvals, draft_notes_and_publish, pipeline};
use crate::report::{Check, Detail, Outcome, Sanitizer, utc_now};

const BASE_FILE: &str = "namespace GrProbe;\n// Synthetic file written by gr-probe (Guided Review field kit).\npublic sealed class Sample\n{\n    public int Count { get; }\n    public Sample(int count) => Count = count;\n    public int Twice() => Count * 2;\n    public int Thrice() => Count * 3;\n    public string Name() => \"probe\";\n    public bool IsEmpty => Count == 0;\n}\n// end\n";
/// Line 8 deleted, line 9 changed, `Half` added as new line 10.
const HEAD_FILE: &str = "namespace GrProbe;\n// Synthetic file written by gr-probe (Guided Review field kit).\npublic sealed class Sample\n{\n    public int Count { get; }\n    public Sample(int count) => Count = count;\n    public int Twice() => Count * 2;\n    public string Name() => \"gr-probe\";\n    public bool IsEmpty => Count == 0;\n    public int Half() => Count / 2;\n}\n// end\n";
pub const FILE_PATH: &str = "gr-probe/Sample.cs";
/// Positions in the diff of HEAD_FILE against BASE_FILE.
pub const ADDED_NEW_LINE: u32 = 10;
pub const DELETED_OLD_LINE: u32 = 8;
pub const CONTEXT_LINES: (u32, u32) = (7, 7);
pub const STALE_SHA: &str = "0000000000000000000000000000000000000000";

fn ci_config(with_confirmation: bool) -> String {
    let confirmation = if with_confirmation {
        "  manual_confirmation: \"Run the gr-probe manual job?\"\n"
    } else {
        ""
    };
    format!(
        "workflow:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == \"merge_request_event\"\ngr-probe-manual:\n  stage: test\n  script:\n    - echo \"GR_PROBE_VAR=$GR_PROBE_VAR\"\n  variables:\n    GR_PROBE_VAR: \"default\"\n  rules:\n    - when: manual\n  allow_failure: true\n{confirmation}"
    )
}

/// Asks on the terminal; anything but "y" stops the sequence.
fn confirm(what: &str) -> bool {
    print!("[write] {what}? [y/N] ");
    let _ = std::io::stdout().flush();
    let mut line = String::new();
    std::io::stdin().lock().read_line(&mut line).is_ok() && line.trim().eq_ignore_ascii_case("y")
}

pub struct Writer<'a> {
    pub session: &'a Session,
    project: String,
    pub checks: Vec<Check>,
}

impl Writer<'_> {
    /// Runs one confirmed write; `None` when declined or failed (the sequence stops).
    pub async fn call(
        &mut self,
        id: &str,
        what: &str,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Option<Value> {
        if !confirm(what) {
            self.checks
                .push(Check::new(id, Outcome::Skip).detail(Detail::Code("declined".into())));
            return None;
        }
        let result = self
            .session
            .client
            .request(
                method,
                &format!("/projects/{}{path}", self.project),
                &[],
                body.as_ref(),
            )
            .await;
        self.checks.push(status_check(id, &result));
        result.ok().map(|response| response.body)
    }

    pub async fn get(&self, path: &str) -> Option<Value> {
        self.session
            .client
            .get(&format!("/projects/{}{path}", self.project), &[])
            .await
            .ok()
            .map(|response| response.body)
    }
}

pub async fn run(args: &Args) -> Result<(Vec<Check>, Sanitizer), String> {
    if args.option("project").is_none() {
        return Err("--project <sandbox project path> is required for writes".into());
    }
    let mut checks = Vec::new();
    let session = connect(args, &mut checks).await?;
    let project = session.project_id().unwrap_or_default().to_owned();
    let mut w = Writer {
        session: &session,
        project,
        checks,
    };
    sequence(&mut w).await;
    let checks = w.checks;
    Ok((checks, session.sanitizer.clone()))
}

async fn sequence(w: &mut Writer<'_>) {
    use reqwest::Method;
    let Some(project) = w.get("").await else {
        w.checks.push(Check::new("project", Outcome::Fail));
        return;
    };
    let default_branch = project
        .get("default_branch")
        .and_then(Value::as_str)
        .unwrap_or("main")
        .to_owned();
    let version = w
        .session
        .client
        .get("/version", &[])
        .await
        .ok()
        .and_then(|r| {
            r.body
                .get("version")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_default();
    let confirmation = crate::env::parse_version(&version).is_some_and(|v| v >= (17, 1, 0));
    let stamp: String = utc_now().chars().filter(char::is_ascii_digit).collect();
    let base = format!("gr-probe/{stamp}-base");
    let head = format!("gr-probe/{stamp}");

    let ci_exists = w
        .get(&format!(
            "/repository/files/.gitlab-ci.yml?ref={default_branch}"
        ))
        .await
        .is_some();
    // 1-4: branches and commits (the MR targets the probe's own base branch, never the default).
    if w.call(
        "w01_branch_base",
        "create branch for the probe base",
        Method::POST,
        "/repository/branches",
        Some(json!({"branch": base, "ref": default_branch})),
    )
    .await
    .is_none()
    {
        return;
    }
    let base_commit = json!({
        "branch": base,
        "commit_message": "gr-probe: synthetic base",
        "actions": [
            {"action": "create", "file_path": FILE_PATH, "content": BASE_FILE},
            {"action": if ci_exists { "update" } else { "create" }, "file_path": ".gitlab-ci.yml", "content": ci_config(confirmation)},
        ],
    });
    if w.call(
        "w02_commit_base",
        "commit the synthetic file and a manual CI job to the base branch",
        Method::POST,
        "/repository/commits",
        Some(base_commit),
    )
    .await
    .is_none()
    {
        return;
    }
    if w.call(
        "w03_branch_head",
        "create the probe source branch",
        Method::POST,
        "/repository/branches",
        Some(json!({"branch": head, "ref": base})),
    )
    .await
    .is_none()
    {
        return;
    }
    let head_commit = json!({
        "branch": head,
        "commit_message": "gr-probe: synthetic change",
        "actions": [{"action": "update", "file_path": FILE_PATH, "content": HEAD_FILE}],
    });
    if w.call(
        "w04_commit_head",
        "commit the synthetic change",
        Method::POST,
        "/repository/commits",
        Some(head_commit),
    )
    .await
    .is_none()
    {
        return;
    }

    // 5: draft MR with the user as reviewer; does `draft: true` work, or only the prefix?
    let mr_body = json!({
        "source_branch": head, "target_branch": base, "title": format!("gr-probe {stamp}"),
        "description": "Synthetic merge request from the Guided Review field probe.",
        "reviewer_ids": [w.session.me_id], "remove_source_branch": false, "draft": true,
    });
    let Some(mr) = w
        .call(
            "w05_create_mr_draft_param",
            "create a merge request with draft: true",
            Method::POST,
            "/merge_requests",
            Some(mr_body),
        )
        .await
    else {
        return;
    };
    let draft_param_works = mr.get("draft").and_then(Value::as_bool).unwrap_or(false);
    w.checks.push(
        Check::new("w05.draft_param_honoured", Outcome::Info)
            .detail(Detail::Bool(draft_param_works)),
    );
    let Some(iid) = mr.get("iid").and_then(Value::as_i64) else {
        return;
    };
    let mr_path = format!("/merge_requests/{iid}");
    if !draft_param_works {
        let renamed = w
            .call(
                "w05b_draft_prefix",
                "mark the merge request as draft with the Draft: prefix",
                Method::PUT,
                &mr_path,
                Some(json!({"title": format!("Draft: gr-probe {stamp}")})),
            )
            .await;
        let draft = renamed
            .as_ref()
            .and_then(|m| m.get("draft"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        w.checks.push(
            Check::new("w05b.draft_prefix_honoured", Outcome::Info).detail(Detail::Bool(draft)),
        );
    }
    let Some(refs) = diff_refs(w, &mr_path).await else {
        w.checks.push(Check::new("w06_diff_refs", Outcome::Fail));
        return;
    };
    w.checks.push(keys_check("w06_mr_detail", &refs.1, 2));

    // 7-8: draft notes and bulk publish.
    if !draft_notes_and_publish(w, &mr_path, &refs.0).await {
        return;
    }
    // 9: approvals.
    approvals(w, &mr_path, &refs.0).await;
    // 10: pipeline with a manual job.
    pipeline(w, &mr_path).await;
    // 11: close the MR (branches stay).
    let _ = w
        .call(
            "w11_close_mr",
            "close the probe merge request",
            Method::PUT,
            &mr_path,
            Some(json!({"state_event": "close"})),
        )
        .await;
}

/// `diff_refs` (base, start, head) once GitLab computed the diff, and the MR body.
async fn diff_refs(w: &Writer<'_>, mr_path: &str) -> Option<(Value, Value)> {
    for _ in 0..20 {
        if let Some(mr) = w.get(mr_path).await {
            let refs = mr.get("diff_refs").cloned().unwrap_or(Value::Null);
            if refs.get("head_sha").is_some_and(Value::is_string) {
                return Some((refs, mr));
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    None
}
