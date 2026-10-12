//! git CLI wrapper (`runner.rs`), diff parsing (`patch.rs`, `diff.rs`), hunk IDs, intraline
//! emphasis; local changes, staging and commits come next. Range-diff, moved code and
//! worktrees follow in later milestones.

pub mod diff;
pub mod error;
pub mod hunk_id;
pub mod intraline;
pub mod model;
pub mod patch;
pub mod runner;

pub use error::GitError;
pub use runner::Git;
