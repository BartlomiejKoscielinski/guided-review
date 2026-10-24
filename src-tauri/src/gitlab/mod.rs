//! GitLab: REST v4 and GraphQL client (`client.rs`), errors, TLS (S6), the account (F-19.5), MR
//! lists (F-02, ADR-024), one MR (`mr.rs`, F-05), its discussions (F-06.9) and the actions on
//! them (`thread_actions.rs`, F-11.2) and the project of a remote; the poller and draft-note
//! positions come later in M5.

pub mod account;
pub mod approvals;
pub mod branch_mr;
pub mod client;
pub mod discussions;
pub mod draft_notes;
pub mod error;
pub mod jobs;
pub mod members;
pub mod mr;
pub mod mrs;
pub mod pipelines;
pub mod project;
pub mod thread_actions;
pub mod tls;
pub mod versions;
