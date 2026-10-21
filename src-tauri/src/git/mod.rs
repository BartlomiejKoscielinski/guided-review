//! git CLI wrapper (`runner.rs`), diff parsing (`patch.rs`, `diff.rs`), hunk IDs, intraline
//! emphasis, local changes with their index state, staging, commit and push, the S-06 tree
//! the working-tree watcher and review worktrees (`worktree.rs`). Range-diff and moved code
//! follow in later milestones.

pub mod commit;
pub mod diff;
pub mod error;
pub mod fixup_target;
pub mod hunk_id;
pub mod intraline;
pub mod line_state;
pub mod local;
pub mod log;
pub mod model;
pub mod patch;
pub mod patch_builder;
pub mod refs;
pub mod runner;
pub mod scratch;
pub mod staging;
pub mod status;
pub mod summary;
pub mod tree;
pub mod watch;
pub mod worktree;

pub use error::GitError;
pub use runner::Git;
