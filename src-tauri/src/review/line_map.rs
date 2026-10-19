//! Where a line of one version of a file is in another version (F-11.3, M5 decision 4): the
//! line is moved through `git diff -U0 <from> <to> -- <path>` (shifted by the hunks above it;
//! a line a hunk changed goes to that hunk's start), then the nearest line of `<to>` with the
//! same text (leading and trailing whitespace ignored) within ±20 lines of it wins, ties going
//! to the upper line. No such line: `None`.
//!
//! Both versions are read from the object store. A commit missing there is fetched once per
//! run of the app by its SHA (`git fetch origin <sha>`, no ref written, docs/05 › git); whether
//! the on-prem GitLab serves old MR versions that way is a field check (**verify**).

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use crate::git::diff::parse_patches;
use crate::git::refs;
use crate::git::{Git, GitError};
use crate::os::process::Cancel;

/// How far from the moved line the same text is looked for.
pub const WINDOW: u32 = 20;
/// A fetch of one old version must not hold the step for long.
const FETCH_TIMEOUT: Duration = Duration::from_secs(60);

/// SHAs this run of the app has tried to fetch: a missing version is asked for once.
static FETCHED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Mutex::default);

/// One hunk of a `-U0` diff: `(old_start, old_lines, new_start, new_lines)`.
pub type Range = (u32, u32, u32, u32);

/// Old-side `line` on the new side: shifted by the hunks above it; a line inside a hunk goes
/// to the hunk's new start (the line after it when the hunk only deletes).
pub fn shift(ranges: &[Range], line: u32) -> u32 {
    let mut delta: i64 = 0;
    for &(old_start, old_lines, new_start, new_lines) in ranges {
        // `-2,0` inserts after line 2; `-20,1` changes line 20.
        let before = if old_lines == 0 {
            line <= old_start
        } else {
            line < old_start
        };
        if before {
            break;
        }
        if old_lines > 0 && line < old_start.saturating_add(old_lines) {
            let start = if new_lines == 0 {
                new_start.saturating_add(1)
            } else {
                new_start
            };
            return start.max(1);
        }
        delta += i64::from(new_lines) - i64::from(old_lines);
    }
    u32::try_from((i64::from(line) + delta).max(1)).unwrap_or(u32::MAX)
}

/// The 1-based line of `lines` nearest to `around` (at most [`WINDOW`] away) whose text is
/// `text`, both trimmed; of two at the same distance the upper one.
pub fn nearest(lines: &[String], text: &str, around: u32) -> Option<u32> {
    let want = text.trim();
    let same = |no: u32| {
        no >= 1
            && usize::try_from(no - 1)
                .ok()
                .and_then(|i| lines.get(i))
                .is_some_and(|l| l.trim() == want)
    };
    (0..=WINDOW).find_map(|d| {
        around
            .checked_sub(d)
            .filter(|&no| same(no))
            .or_else(|| around.checked_add(d).filter(|&no| same(no)))
    })
}

/// Reads versions of files and their diffs for [`LineMap::line`]; each file version and diff
/// is read once.
pub struct LineMap<'a> {
    git: &'a Git,
    cancel: &'a Cancel,
    commits: HashMap<String, bool>,
    files: HashMap<(String, String), Option<Vec<String>>>,
    diffs: HashMap<(String, String, String), Option<Vec<Range>>>,
}

impl<'a> LineMap<'a> {
    pub fn new(git: &'a Git, cancel: &'a Cancel) -> Self {
        Self {
            git,
            cancel,
            commits: HashMap::new(),
            files: HashMap::new(),
            diffs: HashMap::new(),
        }
    }

    /// Line `line` of `path` at commit `from`, found at commit `to` (see the module docs);
    /// `None` when either version can't be read or no line has its text near enough.
    pub async fn line(&mut self, from: &str, to: &str, path: &str, line: u32) -> Option<u32> {
        if !self.readable(from).await || !self.readable(to).await {
            return None;
        }
        let index = usize::try_from(line.checked_sub(1)?).ok()?;
        let text = self.file(from, path).await?.get(index)?.clone();
        let around = if from == to {
            line
        } else {
            shift(&self.diff(from, to, path).await?, line)
        };
        nearest(self.file(to, path).await?, &text, around)
    }

    /// The commit is in the object store, fetched now if it wasn't.
    pub async fn readable(&mut self, sha: &str) -> bool {
        if let Some(&known) = self.commits.get(sha) {
            return known;
        }
        let known = refs::is_sha_like(sha) && self.has(sha).await || self.fetch(sha).await;
        self.commits.insert(sha.to_owned(), known);
        known
    }

    async fn has(&self, sha: &str) -> bool {
        matches!(
            refs::verify_commit(self.git, sha, self.cancel).await,
            Ok(Some(_))
        )
    }

    /// `git fetch origin <sha>`, once per SHA per run; true when the commit is there after it.
    async fn fetch(&self, sha: &str) -> bool {
        if !refs::is_sha_like(sha) {
            return false;
        }
        let first = FETCHED
            .lock()
            .map(|mut tried| tried.insert(sha.to_owned()))
            .unwrap_or(false);
        if !first {
            return false;
        }
        let spec = self
            .git
            .spec([
                "fetch",
                "--quiet",
                "--no-tags",
                "--no-write-fetch-head",
                "origin",
                sha,
            ])
            .timeout(FETCH_TIMEOUT);
        if let Err(error) = self.git.run_spec(spec, self.cancel, &[0]).await {
            // The command and exit code only: stderr may name the remote.
            tracing::info!(
                code = ?failed_code(&error),
                "an old MR version could not be fetched; its threads go to the file header"
            );
            return false;
        }
        self.has(sha).await
    }

    /// The lines of `path` at `sha`; `None` when the file isn't there.
    async fn file(&mut self, sha: &str, path: &str) -> Option<&Vec<String>> {
        let key = (sha.to_owned(), path.to_owned());
        if !self.files.contains_key(&key) {
            let lines = self.read(sha, path).await;
            self.files.insert(key.clone(), lines);
        }
        self.files.get(&key)?.as_ref()
    }

    async fn read(&self, sha: &str, path: &str) -> Option<Vec<String>> {
        let spec = self.git.spec([
            "cat-file".to_owned(),
            "blob".to_owned(),
            format!("{sha}:{path}"),
        ]);
        let output = self.git.run_spec(spec, self.cancel, &[0]).await.ok()?;
        Some(output.stdout.lines().map(str::to_owned).collect())
    }

    /// The hunks of `path` from `from` to `to`, without context.
    async fn diff(&mut self, from: &str, to: &str, path: &str) -> Option<Vec<Range>> {
        let key = (from.to_owned(), to.to_owned(), path.to_owned());
        if !self.diffs.contains_key(&key) {
            let ranges = self.ranges(from, to, path).await;
            self.diffs.insert(key.clone(), ranges);
        }
        self.diffs.get(&key)?.clone()
    }

    async fn ranges(&self, from: &str, to: &str, path: &str) -> Option<Vec<Range>> {
        let args = [
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-renames",
            "-U0",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            from,
            to,
            "--",
            path,
        ];
        let output = self.git.run(args, self.cancel).await.ok()?;
        let patches = parse_patches(&output.stdout).ok()?;
        Some(
            patches
                .iter()
                .flat_map(|p| &p.hunks)
                .map(|h| (h.old_start, h.old_lines, h.new_start, h.new_lines))
                .collect(),
        )
    }
}

fn failed_code(error: &GitError) -> Option<i32> {
    match error {
        GitError::Failed { code, .. } => *code,
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(texts: &[&str]) -> Vec<String> {
        texts.iter().map(|t| (*t).to_owned()).collect()
    }

    #[test]
    fn f11_3_shift_moves_by_the_hunks_above_and_to_the_start_of_a_changing_hunk() {
        // 12 lines inserted after line 2, line 30 changed, line 40 deleted.
        let ranges = [(2, 0, 3, 12), (30, 1, 42, 1), (40, 1, 51, 0)];
        assert_eq!(shift(&ranges, 1), 1);
        assert_eq!(shift(&ranges, 2), 2);
        assert_eq!(shift(&ranges, 3), 15);
        assert_eq!(shift(&ranges, 30), 42);
        assert_eq!(shift(&ranges, 35), 47);
        assert_eq!(shift(&ranges, 40), 52);
        assert_eq!(shift(&ranges, 45), 56);
        assert_eq!(shift(&[], 7), 7);
    }

    #[test]
    fn f11_3_nearest_same_trimmed_text_within_20_lines_and_ties_go_up() {
        let mut file = vec!["x".to_owned(); 60];
        file[24] = "  call();".to_owned();
        file[34] = "call();  ".to_owned();
        assert_eq!(nearest(&file, "call();", 30), Some(25));
        assert_eq!(nearest(&file, "call();", 33), Some(35));
        assert_eq!(nearest(&file, "call();", 5), Some(25));
        assert_eq!(nearest(&file, "call();", 4), None);
        assert_eq!(nearest(&file, "other();", 30), None);
        assert_eq!(nearest(&lines(&["a"]), "a", 1), Some(1));
        assert_eq!(nearest(&lines(&["a"]), "a", 0), Some(1));
    }
}
