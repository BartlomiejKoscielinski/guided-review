//! Claude Code runner (the only place that builds `claude` command lines), discovery (ADR-021),
//! result parsing and error mapping, the queue, startup checks and status, prompts and tasks.
//! Tasks of later milestones (plan, step analysis, …) join `tasks` here.

pub mod commit_message;
pub mod discover;
pub mod error;
pub mod exec;
pub mod models;
pub mod prompts;
pub mod queue;
pub mod result;
pub mod runner;
pub mod status;
pub mod task_dir;

pub use error::ClaudeError;
