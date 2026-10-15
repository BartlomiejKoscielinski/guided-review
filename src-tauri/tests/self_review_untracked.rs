//! Self-review (F-17.1) of uncommitted changes whose untracked files sit in a dot directory
//! (an IDE's `.idea` folder; the live check of attempt 1 failed every step there): every step is
//! analyzed from the repository root, and notes on the untracked files validate however Claude
//! names the step's file. Fake `claude`, synthetic data only (ADR-019). The logged reason of a
//! failed step is checked in `self_review_untracked_log.rs`, a binary of its own because it
//! installs the global logger.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

#[path = "support/fake_claude.rs"]
mod fake_claude;
#[path = "support/fixture_repo.rs"]
mod fixture_repo;
#[path = "support/untracked_session.rs"]
mod untracked_session;

use std::path::Path;

use guided_review_lib::error::{AppError, ErrorCode};
use guided_review_lib::review::model::Strategy;
use guided_review_lib::review::step_runs::StepRuns;
use untracked_session::{ENCODINGS, SERVICE, absolute, note_on, path, same_dir, setup};

#[tokio::test]
async fn f17_1_untracked_files_in_a_dot_directory_are_planned_and_analyzed() {
    let s = setup();
    let (files, cx) = s.planned().await;
    let order = cx.order(Strategy::ContractToUi);
    assert_eq!(order.len(), 3);
    let runs = StepRuns::default();
    for (i, id) in order.iter().enumerate() {
        let file = path(&files[i]);
        // The step's file as the diff names it, absolute with backslashes, and relative with
        // backslashes: each is the same step file.
        let named = match i {
            0 => file.clone(),
            1 => absolute(&s.repo.path, &file),
            _ => file.replace('/', "\\"),
        };
        s.respond(&[note_on(&named)]);
        let analysis = s
            .findings(&runs, &cx, &order, id)
            .await
            .unwrap_or_else(|e| panic!("step {id} on {named}: {e:?}"));
        assert_eq!(analysis.findings.len(), 1, "{named}");
        let note = &analysis.findings[0];
        assert_eq!(note.file, file);
        assert_eq!(note.evidence[0].file, file);
        assert_eq!(note.evidence[1].file, SERVICE);
        assert_eq!(analysis.folds[0].file, file);
        assert_eq!(analysis.files_read[0].file, file);
        let call = s.fake.calls().last().unwrap().clone();
        assert!(same_dir(
            Path::new(call["cwd"].as_str().unwrap()),
            &s.repo.path
        ));
        let diff = call["addDirFiles"]["step.diff"].as_str().unwrap();
        assert!(diff.contains(&format!("b/{file}")), "{diff}");
    }
    // Opening each step again is a cache hit: no further `claude` run.
    let before = s.fake.calls().len();
    for id in &order {
        s.findings(&runs, &cx, &order, id).await.unwrap();
    }
    assert_eq!(s.fake.calls().len(), before);
}

#[tokio::test]
async fn f17_1_a_note_on_a_file_outside_the_step_still_fails_the_step() {
    let s = setup();
    let (files, cx) = s.planned().await;
    let order = cx.order(Strategy::ContractToUi);
    // Step 1 is the service; a note on the `.idea` folder or on another step's file is rejected
    // however it is named.
    assert_eq!(path(&files[0]), SERVICE);
    let runs = StepRuns::default();
    for named in [
        "src/Delivery.App/Services/.idea".to_owned(),
        absolute(&s.repo.path, ENCODINGS),
    ] {
        s.respond(&[note_on(&named)]);
        let error = s.findings(&runs, &cx, &order, &order[0]).await.unwrap_err();
        let error = AppError::from(error);
        assert_eq!(error.code, ErrorCode::ClaudeSchema, "{named}");
        assert_eq!(
            error.detail.as_deref(),
            Some("a finding on a file outside the step")
        );
    }
}
