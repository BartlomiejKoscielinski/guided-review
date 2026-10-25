//! F-25.2 The post-run check of a fix (docs/05 › Fix on own code, ADR-018, T3): after Claude
//! exits, `git status --porcelain=v2 -z -uall` in the scratch worktree may name only the one
//! file. Anything else discards the run (the scratch is removed) with `CLAUDE_GUARD_VIOLATION`.
//! `-uall` lists untracked files one by one, so a new file next to an untracked target is seen.

use crate::error::{AppError, AppResult, ErrorCode};
use crate::git::Git;
use crate::git::scratch::{self, Scratch};
use crate::os::process::Cancel;
use crate::store::Store;

/// The message of a guard violation (the detail lists the other paths).
pub fn violation_message(file: &str) -> String {
    format!("Claude changed files other than {file}, so the run was discarded.")
}

/// `Ok` when nothing but `scratch.file` differs from the base in the scratch worktree;
/// otherwise the scratch is removed and the error is `CLAUDE_GUARD_VIOLATION`. A status that
/// can't be read discards the run as well.
pub async fn verify(git: &Git, store: &Store, scratch: &Scratch, cancel: &Cancel) -> AppResult<()> {
    let target = match scratch::git_path(&scratch.file) {
        Ok(target) => target,
        Err(error) => {
            scratch::remove(git, store, scratch).await;
            return Err(error.into());
        }
    };
    let status = git
        .at(&scratch.path)
        .run(["status", "--porcelain=v2", "-z", "-uall"], cancel)
        .await;
    let others = match status {
        Ok(output) => other_paths(&output.stdout, &target),
        Err(error) => {
            scratch::remove(git, store, scratch).await;
            return Err(error.into());
        }
    };
    if others.is_empty() {
        return Ok(());
    }
    scratch::remove(git, store, scratch).await;
    let name = target.rsplit('/').next().unwrap_or(&target);
    Err(
        AppError::new(ErrorCode::ClaudeGuardViolation, violation_message(name))
            .with_detail(others.join(", ")),
    )
}

/// The paths in `git status --porcelain=v2 -z` output other than `target` (both sides of a
/// rename count).
pub fn other_paths(status: &str, target: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut fields = status.split('\0');
    while let Some(entry) = fields.next() {
        let path = match entry.as_bytes().first() {
            Some(b'1') => entry.splitn(9, ' ').nth(8),
            Some(b'2') => {
                if let Some(orig) = fields.next() {
                    paths.push(orig.to_owned());
                }
                entry.splitn(10, ' ').nth(9)
            }
            Some(b'u') => entry.splitn(11, ' ').nth(10),
            Some(b'?' | b'!') => entry.get(2..),
            _ => None,
        };
        if let Some(path) = path {
            paths.push(path.to_owned());
        }
    }
    paths.retain(|p| p != target);
    paths.sort();
    paths.dedup();
    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = "src/Zażółć gęślą/Upload Queue.cs";

    #[test]
    fn f25_2_only_the_target_passes() {
        let status = format!("1 .M N... 100644 100644 100644 abc abc {FILE}\0");
        assert!(other_paths(&status, FILE).is_empty());
        let untracked = format!("? {FILE}\0");
        assert!(other_paths(&untracked, FILE).is_empty());
        assert!(other_paths("", FILE).is_empty());
    }

    #[test]
    fn f25_2_every_other_entry_kind_is_reported() {
        let status = format!(
            "1 .M N... 100644 100644 100644 abc abc {FILE}\0\
             1 .D N... 100644 100644 000000 abc abc README.md\0\
             2 R. N... 100644 100644 100644 abc abc R100 {FILE}\0src/Old Name.cs\0\
             u UU N... 100644 100644 100644 100644 a b c src/Conflict ą.cs\0\
             ? src/Nowe Ćmy/Sibling.cs\0"
        );
        assert_eq!(
            other_paths(&status, FILE),
            [
                "README.md",
                "src/Conflict ą.cs",
                "src/Nowe Ćmy/Sibling.cs",
                "src/Old Name.cs"
            ]
        );
    }

    #[test]
    fn f25_2_the_violation_names_the_file() {
        assert_eq!(
            violation_message("Upload Queue.cs"),
            "Claude changed files other than Upload Queue.cs, so the run was discarded."
        );
    }
}
