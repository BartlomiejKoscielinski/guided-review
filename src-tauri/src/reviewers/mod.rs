//! Reviewer suggestions of S-11 New merge request (F-27.3, M7 decisions 17 and 18): code owners
//! from the target's CODEOWNERS (`codeowners.rs`), the authors of the changed lines from
//! `git blame` (`blame_share.rs`), who reviewed merged MRs in the area of the change this month
//! (`history.rs`), and the ranked list of at most three people (`suggest.rs`). Reads only.

pub mod blame_share;
pub mod codeowners;
pub mod history;
pub mod suggest;
