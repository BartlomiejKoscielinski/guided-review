//! The integration tests in one binary (E29, docs/process/IMPROVEMENTS.md): one module per
//! area, so `cargo test` links and starts one executable instead of one per file. A new test
//! file goes into this folder with a `mod` line below. All of them run in parallel in one
//! process: a test that changes process-global state (installs the global logger, sets an
//! environment variable or the current directory) stays a binary of its own in `tests/`, like
//! `gitlab_logging.rs` (clippy.toml › disallowed-methods).

#[path = "../support/cassette.rs"]
mod cassette;
#[path = "../support/fake_claude.rs"]
mod fake_claude;
#[path = "../support/fixture_repo.rs"]
mod fixture_repo;
#[path = "../support/mr_drafts.rs"]
mod mr_drafts;
#[path = "../support/tls_server.rs"]
mod tls_server;
#[path = "../support/untracked_session.rs"]
mod untracked_session;

mod analysis_status;
mod ask_task;
mod browser_open;
mod claude_tasks;
mod drafts_of_the_mr;
mod drafts_of_the_mr_pick_up;
mod drafts_of_the_mr_review;
mod eval_claude;
mod fix_accept;
mod fix_proposal;
mod fix_scratch;
mod fix_task;
mod git_diff;
mod git_local;
mod git_watch;
mod gitlab_account;
mod gitlab_approvals;
mod gitlab_approve;
mod gitlab_client;
mod gitlab_discussions;
mod gitlab_mrs;
mod gitlab_thread_actions;
mod job_log;
mod job_play;
mod mechanical;
mod open_mr;
mod pipeline_actions;
mod pipeline_artifacts;
mod pipeline_explain_task;
mod pipeline_jobs;
mod pipeline_retry;
mod pipeline_run;
mod pipeline_view;
mod plan_runs;
mod plan_task;
mod plan_threads;
mod prepare;
mod privacy;
mod process;
mod publish_drafts;
mod publish_drafts_only;
mod publish_never_approves;
mod publish_note_refs;
mod publish_remap;
mod publish_retry_notes;
mod resume;
mod self_review;
mod self_review_untracked;
mod session_summary;
mod sources;
mod step_runs;
mod step_task;
mod step_threads;
mod summary_task;
mod tauri_security;
mod thread_check_task;
mod thread_place;
mod tls;
