//! The title S-11 New merge request opens with (F-27.2, M7 decision 15), read from the branch's
//! commits without Claude: a single commit gives its subject, several give the branch name in
//! words (`chore/compiled-bindings` → "Chore compiled bindings"). Reads only.

use super::branch_info::branch_range;
use super::error::GitError;
use super::refs;
use super::runner::Git;
use crate::os::process::Cancel;

/// The title for an MR of the current branch into `target` (as for `branch_info`: a branch on
/// `origin`, the default when `None`). Empty when there is nothing to name it after (no commits
/// ahead of the target, no common history); a target that is no branch on `origin` is refused.
pub async fn mr_title(
    git: &Git,
    target: Option<&str>,
    cancel: &Cancel,
) -> Result<String, GitError> {
    let Some((base, head)) = branch_range(git, target, cancel).await? else {
        return Ok(String::new());
    };
    let count = git
        .run(["rev-list", "--count", &format!("{base}..{head}")], cancel)
        .await?;
    let subject = || async {
        let log = git
            .run(["log", "-1", "--no-color", "--format=%s", &head], cancel)
            .await?;
        Ok::<_, GitError>(log.stdout.trim().to_owned())
    };
    match count.stdout.trim().parse::<u32>().unwrap_or(0) {
        0 => Ok(String::new()),
        1 => subject().await,
        _ => match refs::current_branch(git, cancel).await? {
            Some(branch) => Ok(words(&branch)),
            // A detached HEAD has no name: the latest subject is the closest thing to one.
            None => subject().await,
        },
    }
}

/// The branch name in words: `/`, `-` and `_` become spaces, the first letter is capitalised and
/// the rest stays as written.
pub fn words(branch: &str) -> String {
    let joined = branch
        .split(['/', '-', '_'])
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let mut chars = joined.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f27_2_words_split_on_separators_and_capitalise_the_first_letter() {
        assert_eq!(words("chore/compiled-bindings"), "Chore compiled bindings");
        assert_eq!(words("fix//scanner--crash_"), "Fix scanner crash");
        assert_eq!(words("żółw/pływa"), "Żółw pływa");
        assert_eq!(words("/-_"), "");
    }
}
