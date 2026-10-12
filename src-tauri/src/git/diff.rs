//! Diffs between two commits (F-05.2): the changed files with rename detection and counts
//! from one `git diff --raw --numstat -z -M` call, and per-file patches loaded on demand.
//! Binary files are listed but not rendered. Patches are turned into the UI model here.

use std::ffi::OsString;

use serde::Serialize;
use ts_rs::TS;

use super::error::GitError;
use super::hunk_id;
use super::intraline;
use super::model::{FileDiff, FileStatus, Hunk, Line, LineKind, display_text};
use super::patch::{self, PatchFile};
use super::runner::Git;
use crate::os::process::Cancel;

/// Arguments of every patch: no colors or external diff tools, full blob IDs (stable
/// file-level hunk IDs), renames, 3 lines of context and fixed `a/`/`b/` prefixes whatever
/// the user's `diff.noprefix` or `diff.mnemonicPrefix` say.
pub const PATCH_ARGS: [&str; 8] = [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--full-index",
    "-M",
    "-U3",
    "--src-prefix=a/",
    "--dst-prefix=b/",
];

/// One changed file in a list (tree rows, F-15.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChangedFile {
    /// The current path (the old one for a deletion).
    pub path: String,
    /// The path before a rename or copy.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub binary: bool,
    pub additions: u32,
    pub deletions: u32,
}

/// The empty tree of the repository's hash algorithm (parent of a root commit).
pub async fn empty_tree(git: &Git, cancel: &Cancel) -> Result<String, GitError> {
    let spec = git
        .spec(["hash-object", "-t", "tree", "--stdin"])
        .stdin(Vec::new());
    let output = git.run_spec(spec, cancel, &[0]).await?;
    Ok(output.stdout.trim().to_owned())
}

/// `git merge-base a b` (the MR's base for F-05.2).
pub async fn merge_base(git: &Git, a: &str, b: &str, cancel: &Cancel) -> Result<String, GitError> {
    let output = git.run(["merge-base", a, b], cancel).await?;
    Ok(output.stdout.trim().to_owned())
}

/// Changed files between two trees or commits (`base` → `head`), with renames.
pub async fn range_files(
    git: &Git,
    base: &str,
    head: &str,
    cancel: &Cancel,
) -> Result<Vec<ChangedFile>, GitError> {
    let output = git
        .run(
            [
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--raw",
                "--numstat",
                "-z",
                "-M",
                base,
                head,
            ],
            cancel,
        )
        .await?;
    parse_raw_numstat(&output.stdout).ok_or(GitError::Parse {
        command: "diff --raw --numstat".to_owned(),
        what: "file list",
    })
}

/// The patch of one file between two commits.
pub async fn range_file_diff(
    git: &Git,
    base: &str,
    head: &str,
    file: &ChangedFile,
    cancel: &Cancel,
) -> Result<FileDiff, GitError> {
    let mut args: Vec<OsString> = PATCH_ARGS.iter().map(OsString::from).collect();
    args.extend([base.into(), head.into(), "--".into()]);
    if let Some(old) = &file.old_path {
        args.push(old.into());
    }
    args.push((&file.path).into());
    let output = git.run(args, cancel).await?;
    let patches = parse_patches(&output.stdout)?;
    let patch = patches
        .into_iter()
        .find(|p| p.path() == file.path)
        .ok_or(GitError::Parse {
            command: "diff".to_owned(),
            what: "patch for the requested file",
        })?;
    Ok(to_model(&patch, !output.lossy))
}

pub fn parse_patches(text: &str) -> Result<Vec<PatchFile>, GitError> {
    patch::parse(text).map_err(|_| GitError::Parse {
        command: "diff".to_owned(),
        what: "patch",
    })
}

/// Parses `--raw --numstat -z` output: raw entries (`:modes shas status\0path\0[path\0]`)
/// followed by numstat entries (`add\tdel\tpath\0` or `add\tdel\t\0old\0new\0`).
pub fn parse_raw_numstat(text: &str) -> Option<Vec<ChangedFile>> {
    let mut tokens = text.split('\0').filter(|t| !t.is_empty()).peekable();
    let mut files: Vec<ChangedFile> = Vec::new();
    let mut counts = Vec::new();
    while let Some(token) = tokens.next() {
        if let Some(raw) = token.strip_prefix(':') {
            let status_field = raw.split(' ').nth(4)?;
            let (status, two_paths) = match status_field.as_bytes().first()? {
                b'A' => (FileStatus::Added, false),
                b'D' => (FileStatus::Deleted, false),
                b'R' => (FileStatus::Renamed, true),
                b'C' => (FileStatus::Copied, true),
                _ => (FileStatus::Modified, false),
            };
            let first = tokens.next()?.to_owned();
            let (path, old_path) = if two_paths {
                (tokens.next()?.to_owned(), Some(first))
            } else {
                (first, None)
            };
            files.push(ChangedFile {
                path,
                old_path,
                status,
                binary: false,
                additions: 0,
                deletions: 0,
            });
        } else {
            let mut parts = token.splitn(3, '\t');
            let add = parts.next()?;
            let del = parts.next()?;
            let rest = parts.next().unwrap_or_default();
            if rest.is_empty() {
                // Rename or copy: the two paths follow as separate tokens.
                tokens.next()?;
                tokens.next()?;
            }
            counts.push((add.parse::<u32>().ok(), del.parse::<u32>().ok()));
        }
    }
    if counts.len() != files.len() {
        return None;
    }
    for (file, (add, del)) in files.iter_mut().zip(counts) {
        file.binary = add.is_none() && del.is_none();
        file.additions = add.unwrap_or(0);
        file.deletions = del.unwrap_or(0);
    }
    Some(files)
}

/// Turns a parsed patch into the UI model: hunk IDs, display text, line numbers and
/// intraline emphasis. `line_staging` is false when the text wasn't valid UTF-8.
pub fn to_model(patch: &PatchFile, utf8: bool) -> FileDiff {
    let ids = hunk_id::assign(std::slice::from_ref(patch))
        .pop()
        .unwrap_or_default();
    let mode_change = match (&patch.old_mode, &patch.new_mode) {
        (Some(old), Some(new)) if old != new && patch.status != FileStatus::Added => {
            Some(format!("{old} → {new}"))
        }
        _ => None,
    };
    let hunks = if hunk_id::needs_file_level_hunk(patch) {
        vec![Hunk {
            id: ids.first().cloned().unwrap_or_default(),
            old_start: 0,
            old_lines: 0,
            new_start: 0,
            new_lines: 0,
            header: String::new(),
            lines: Vec::new(),
            file_level: true,
            staged_differs: false,
        }]
    } else {
        patch
            .hunks
            .iter()
            .zip(ids)
            .map(|(hunk, id)| {
                let mut lines: Vec<Line> = hunk
                    .numbered()
                    .map(|(old_no, new_no, line)| Line {
                        kind: line.kind,
                        old_no,
                        new_no,
                        text: display_text(&line.text),
                        emphasis: Vec::new(),
                        staged: None,
                    })
                    .collect();
                add_emphasis(&mut lines);
                Hunk {
                    id,
                    old_start: hunk.old_start,
                    old_lines: hunk.old_lines,
                    new_start: hunk.new_start,
                    new_lines: hunk.new_lines,
                    header: hunk.section.clone(),
                    lines,
                    file_level: false,
                    staged_differs: false,
                }
            })
            .collect()
    };
    FileDiff {
        old_path: patch.old_path.clone(),
        new_path: patch.new_path.clone(),
        status: patch.status,
        binary: patch.binary,
        mode_change,
        additions: patch.additions(),
        deletions: patch.deletions(),
        hunks,
        line_staging: utf8 && !patch.binary,
    }
}

fn add_emphasis(lines: &mut [Line]) {
    let kinds: Vec<LineKind> = lines.iter().map(|l| l.kind).collect();
    for (del, add) in intraline::pairs(&kinds) {
        if let Some((old, new)) = intraline::emphasis(&lines[del].text, &lines[add].text) {
            lines[del].emphasis = old;
            lines[add].emphasis = new;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_raw_and_numstat_with_renames_and_binaries() {
        let text = ":100644 100644 aaa bbb M\0src/A b.cs\0\
:000000 100644 000 ccc A\0new ż.txt\0\
:100644 100644 ddd eee R087\0old.cs\0moved/new.cs\0\
:100644 100644 fff 111 M\0logo.png\0\
3\t1\tsrc/A b.cs\0\
2\t0\tnew ż.txt\0\
4\t4\t\0old.cs\0moved/new.cs\0\
-\t-\tlogo.png\0";
        let files = parse_raw_numstat(text).unwrap();
        assert_eq!(files.len(), 4);
        assert_eq!((files[0].additions, files[0].deletions), (3, 1));
        assert_eq!(files[1].status, FileStatus::Added);
        assert_eq!(files[1].path, "new ż.txt");
        assert_eq!(files[2].status, FileStatus::Renamed);
        assert_eq!(files[2].old_path.as_deref(), Some("old.cs"));
        assert_eq!(files[2].path, "moved/new.cs");
        assert!(files[3].binary);
    }

    #[test]
    fn mismatched_counts_are_rejected() {
        assert_eq!(parse_raw_numstat(":100644 100644 a b M\0x\0"), None);
    }
}
