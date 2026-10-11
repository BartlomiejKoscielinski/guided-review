//! Claude Code runner (the only place that builds `claude` command lines), discovery (ADR-021),
//! result parsing; queue, tasks and prompts come in M1/M3.

pub mod discover;
pub mod result;
pub mod runner;
