//! Claude tasks of M3 and later; each renders its prompt and input files and runs through
//! `runner.rs` only (ADR-025 risk: no other module builds `claude` arguments).

pub mod ask;
pub mod events;
pub mod pipeline_explain;
pub mod pipeline_explain_inputs;
pub mod plan;
pub mod plan_inputs;
pub mod step;
pub mod step_inputs;
pub mod summary_comment;
pub mod thread_check;
pub mod thread_check_inputs;
