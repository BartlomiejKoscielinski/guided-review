//! Review steps of `gitlab write`: positioned draft notes and bulk publish (F-12.4, F-12.5),
//! approvals with the reviewed SHA (F-14.2), list filters (F-02.1), and the MR pipeline with a
//! manual job (F-20.3, F-20.6).

use serde_json::{Value, json};

use crate::gitlab_read::{keys_check, mr_list};
use crate::gitlab_write::{
    ADDED_NEW_LINE, CONTEXT_LINES, DELETED_OLD_LINE, FILE_PATH, STALE_SHA, Writer,
};
use crate::report::{Check, Detail, Outcome};

pub fn position(refs: &Value, old_line: Option<u32>, new_line: Option<u32>) -> Value {
    let mut position = json!({
        "position_type": "text",
        "base_sha": refs["base_sha"], "start_sha": refs["start_sha"], "head_sha": refs["head_sha"],
        "old_path": FILE_PATH, "new_path": FILE_PATH,
    });
    if let Some(line) = old_line {
        position["old_line"] = json!(line);
    }
    if let Some(line) = new_line {
        position["new_line"] = json!(line);
    }
    position
}

pub async fn draft_notes_and_publish(w: &mut Writer<'_>, mr_path: &str, refs: &Value) -> bool {
    use reqwest::Method;
    let drafts = [
        (
            "w07_draft_added_line",
            "gr-probe: added line",
            Some(position(refs, None, Some(ADDED_NEW_LINE))),
        ),
        (
            "w07_draft_deleted_line",
            "gr-probe: deleted line",
            Some(position(refs, Some(DELETED_OLD_LINE), None)),
        ),
        (
            "w07_draft_context_line",
            "gr-probe: context line",
            Some(position(refs, Some(CONTEXT_LINES.0), Some(CONTEXT_LINES.1))),
        ),
        (
            "w07_draft_no_position",
            "gr-probe: summary as a draft without position",
            None,
        ),
    ];
    for (id, note, position) in drafts {
        let mut body = json!({ "note": note });
        if let Some(position) = position {
            body["position"] = position;
        }
        let Some(created) = w
            .call(
                id,
                &format!("create draft note \"{note}\""),
                Method::POST,
                &format!("{mr_path}/draft_notes"),
                Some(body),
            )
            .await
        else {
            return false;
        };
        if id == "w07_draft_added_line" {
            w.checks.push(keys_check("w07_draft_note", &created, 2));
        }
    }
    if w.call(
        "w08_bulk_publish",
        "publish all four drafts at once",
        Method::POST,
        &format!("{mr_path}/draft_notes/bulk_publish"),
        Some(json!({})),
    )
    .await
    .is_none()
    {
        return false;
    }
    let discussions = w
        .get(&format!("{mr_path}/discussions?per_page=100"))
        .await
        .unwrap_or(Value::Null);
    let notes: Vec<&Value> = discussions
        .as_array()
        .map(|d| {
            d.iter()
                .filter_map(|d| d.get("notes").and_then(Value::as_array))
                .flatten()
                .collect()
        })
        .unwrap_or_default();
    let note_with = |text: &str| {
        notes
            .iter()
            .find(|n| n.get("body").and_then(Value::as_str) == Some(text))
            .copied()
    };
    for (id, text, old, new) in [
        (
            "w08.added_line_kept",
            "gr-probe: added line",
            None,
            Some(ADDED_NEW_LINE),
        ),
        (
            "w08.deleted_line_kept",
            "gr-probe: deleted line",
            Some(DELETED_OLD_LINE),
            None,
        ),
        (
            "w08.context_line_kept",
            "gr-probe: context line",
            Some(CONTEXT_LINES.0),
            Some(CONTEXT_LINES.1),
        ),
    ] {
        let kept = note_with(text)
            .and_then(|n| n.get("position"))
            .is_some_and(|p| {
                let line = |key: &str| {
                    p.get(key)
                        .and_then(Value::as_u64)
                        .and_then(|l| u32::try_from(l).ok())
                };
                line("old_line") == old && line("new_line") == new
            });
        w.checks
            .push(Check::new(id, Outcome::Info).detail(Detail::Bool(kept)));
    }
    let general = note_with("gr-probe: summary as a draft without position")
        .is_some_and(|n| n.get("position").is_none_or(Value::is_null));
    w.checks.push(
        Check::new("w08.no_position_draft_is_general_comment", Outcome::Info)
            .detail(Detail::Bool(general)),
    );
    if let Some(note) = note_with("gr-probe: added line") {
        w.checks.push(keys_check("w08_published_note", note, 3));
    }
    // F-12.4 alternative: the summary as bulk_publish's own `note`.
    let Some(_) = w
        .call(
            "w08b_draft_for_summary_publish",
            "create one more draft note",
            Method::POST,
            &format!("{mr_path}/draft_notes"),
            Some(json!({"note": "gr-probe: second round"})),
        )
        .await
    else {
        return false;
    };
    let summary =
        json!({"note": "gr-probe: summary passed to bulk_publish", "reviewer_state": "reviewed"});
    if w.call(
        "w08b_bulk_publish_with_note",
        "publish it with a summary note and reviewer_state reviewed",
        Method::POST,
        &format!("{mr_path}/draft_notes/bulk_publish"),
        Some(summary),
    )
    .await
    .is_some()
    {
        let discussions = w
            .get(&format!("{mr_path}/discussions?per_page=100"))
            .await
            .unwrap_or(Value::Null);
        let has_summary = discussions
            .to_string()
            .contains("gr-probe: summary passed to bulk_publish");
        w.checks.push(
            Check::new("w08b.summary_note_published", Outcome::Info)
                .detail(Detail::Bool(has_summary)),
        );
    }
    true
}

pub async fn approvals(w: &mut Writer<'_>, mr_path: &str, refs: &Value) {
    use reqwest::Method;
    if let Some(state) = w.get(&format!("{mr_path}/approvals")).await {
        w.checks.push(keys_check("w09_approvals_before", &state, 3));
    }
    // Expected: 409 Conflict (05 › Approve with the reviewed SHA, F-14.2).
    let _ = w
        .call(
            "w09_approve_stale_sha",
            "approve with a stale SHA (expected to be refused)",
            Method::POST,
            &format!("{mr_path}/approve"),
            Some(json!({"sha": STALE_SHA})),
        )
        .await;
    let head = refs["head_sha"].as_str().unwrap_or_default().to_owned();
    if w.call(
        "w09_approve_head_sha",
        "approve with the head SHA",
        Method::POST,
        &format!("{mr_path}/approve"),
        Some(json!({"sha": head})),
    )
    .await
    .is_some()
    {
        if let Some(state) = w.get(&format!("{mr_path}/approvals")).await {
            let approved = state
                .get("approved_by")
                .and_then(Value::as_array)
                .is_some_and(|a| !a.is_empty());
            w.checks.push(
                Check::new("w09.approved_by_listed", Outcome::Info).detail(Detail::Bool(approved)),
            );
        }
        list_membership(w, mr_path).await;
        let _ = w
            .call(
                "w09_unapprove",
                "revoke the approval",
                Method::POST,
                &format!("{mr_path}/unapprove"),
                None,
            )
            .await;
    }
}

/// Whether the probe MR shows up under the F-02.1 filters while approved by the user.
pub async fn list_membership(w: &mut Writer<'_>, mr_path: &str) {
    let iid: i64 = mr_path
        .rsplit('/')
        .next()
        .and_then(|i| i.parse().ok())
        .unwrap_or_default();
    let (path, base) = mr_list(w.session);
    let me = w.session.me_username.clone();
    for (name, extra) in [
        ("reviewer_username", ("reviewer_username", me.clone())),
        ("author_username", ("author_username", me.clone())),
        (
            "approved_by_usernames_me",
            ("approved_by_usernames[]", me.clone()),
        ),
        (
            "not_approved_by_usernames_me",
            ("not[approved_by_usernames][]", me.clone()),
        ),
    ] {
        let mut query = base.clone();
        query.extend([("state", "opened".to_owned()), extra]);
        let listed = w
            .session
            .client
            .get_pages(&path, &query, 1)
            .await
            .map(|(items, _)| {
                items
                    .iter()
                    .any(|mr| mr.get("iid").and_then(Value::as_i64) == Some(iid))
            });
        let check = match listed {
            Ok(listed) => Check::new(&format!("w10.listed_by_{name}"), Outcome::Info)
                .detail(Detail::Bool(listed)),
            Err(error) => Check::new(&format!("w10.listed_by_{name}"), Outcome::Fail)
                .detail(Detail::Code(crate::tls::error_code(&error))),
        };
        w.checks.push(check);
    }
}

pub async fn pipeline(w: &mut Writer<'_>, mr_path: &str) {
    use reqwest::Method;
    let Some(pipeline) = w
        .call(
            "w12_run_mr_pipeline",
            "run a merge request pipeline (one manual job, no runner needed until played)",
            Method::POST,
            &format!("{mr_path}/pipelines"),
            None,
        )
        .await
    else {
        return;
    };
    let Some(pipeline_id) = pipeline.get("id").and_then(Value::as_i64) else {
        return;
    };
    let jobs = w
        .get(&format!("/pipelines/{pipeline_id}/jobs"))
        .await
        .unwrap_or(Value::Null);
    w.checks.push(keys_check("w12_jobs", &jobs, 3));
    let Some(job) = jobs.as_array().and_then(|j| {
        j.iter()
            .find(|j| j.get("name").and_then(Value::as_str) == Some("gr-probe-manual"))
    }) else {
        return;
    };
    let status = job
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    w.checks
        .push(Check::new("w12.manual_job_status", Outcome::Info).detail(Detail::Code(status)));
    let Some(job_id) = job.get("id").and_then(Value::as_i64) else {
        return;
    };
    let variables =
        json!({"job_variables_attributes": [{"key": "GR_PROBE_VAR", "value": "from-probe"}]});
    if w.call(
        "w13_play_manual_job",
        "play the manual job with GR_PROBE_VAR=from-probe",
        Method::POST,
        &format!("/jobs/{job_id}/play"),
        Some(variables),
    )
    .await
    .is_some()
    {
        let _ = w
            .call(
                "w13_cancel_job",
                "cancel the job again",
                Method::POST,
                &format!("/jobs/{job_id}/cancel"),
                None,
            )
            .await;
    }
}
