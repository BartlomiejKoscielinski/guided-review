//! Unified diff parser for `git diff --no-color --no-ext-diff --full-index -M` output
//! (docs/05 › Diff parsing): file headers with renames, copies, mode changes, new and deleted
//! files, binary files, hunks with their function context and `\ No newline at end of file`.
//!
//! Lines keep their raw text (a `\r` before the line end stays), because staging rebuilds
//! patches from them; `model.rs` strips it for display.

use super::model::{FileStatus, LineKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchFile {
    /// `None` for an added file.
    pub old_path: Option<String>,
    /// `None` for a deleted file.
    pub new_path: Option<String>,
    pub status: FileStatus,
    pub binary: bool,
    pub old_mode: Option<String>,
    pub new_mode: Option<String>,
    /// Full blob IDs from the `index` line (`--full-index`); all zeros for a missing side.
    pub old_blob: Option<String>,
    pub new_blob: Option<String>,
    pub hunks: Vec<PatchHunk>,
}

impl PatchFile {
    /// The path shown for the file: the new one, or the old one for a deletion.
    pub fn path(&self) -> &str {
        self.new_path
            .as_deref()
            .or(self.old_path.as_deref())
            .unwrap_or_default()
    }

    pub fn additions(&self) -> u32 {
        self.count(LineKind::Add)
    }

    pub fn deletions(&self) -> u32 {
        self.count(LineKind::Del)
    }

    fn count(&self, kind: LineKind) -> u32 {
        let n = self
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .filter(|l| l.kind == kind)
            .count();
        u32::try_from(n).unwrap_or(u32::MAX)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// Function context after the second `@@` (may be empty).
    pub section: String,
    pub lines: Vec<PatchLine>,
}

impl PatchHunk {
    /// Old and new line numbers of every line, in order.
    pub fn numbered(&self) -> impl Iterator<Item = (Option<u32>, Option<u32>, &PatchLine)> {
        let mut old = self.old_start;
        let mut new = self.new_start;
        self.lines.iter().map(move |line| match line.kind {
            LineKind::Ctx => {
                let r = (Some(old), Some(new), line);
                old += 1;
                new += 1;
                r
            }
            LineKind::Del => {
                let r = (Some(old), None, line);
                old += 1;
                r
            }
            LineKind::Add => {
                let r = (None, Some(new), line);
                new += 1;
                r
            }
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchLine {
    pub kind: LineKind,
    /// Raw text without the leading marker and the `\n` (a `\r` is kept).
    pub text: String,
    /// Followed by `\ No newline at end of file`.
    pub no_newline: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unexpected diff output at line {line}: {reason}")]
pub struct PatchError {
    pub line: usize,
    pub reason: &'static str,
}

/// Parses the whole output of one `git diff` call.
pub fn parse(text: &str) -> Result<Vec<PatchFile>, PatchError> {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut files = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(rest) = line.strip_prefix("diff --git ") {
            let (file, next) = parse_file(&lines, i, rest)?;
            files.push(file);
            i = next;
        } else if line.trim().is_empty() {
            i += 1;
        } else {
            return Err(PatchError {
                line: i + 1,
                reason: "expected a diff --git header",
            });
        }
    }
    Ok(files)
}

fn parse_file(
    lines: &[&str],
    start: usize,
    git_line: &str,
) -> Result<(PatchFile, usize), PatchError> {
    let mut file = PatchFile {
        old_path: None,
        new_path: None,
        status: FileStatus::Modified,
        binary: false,
        old_mode: None,
        new_mode: None,
        old_blob: None,
        new_blob: None,
        hunks: Vec::new(),
    };
    let (git_old, git_new) = split_git_line(git_line);
    let mut minus: Option<Option<String>> = None;
    let mut plus: Option<Option<String>> = None;
    let mut i = start + 1;
    while i < lines.len() {
        let line = lines[i].strip_suffix('\r').unwrap_or(lines[i]);
        if line.starts_with("diff --git ") || line.starts_with("@@ ") {
            break;
        }
        if let Some(mode) = line.strip_prefix("old mode ") {
            file.old_mode = Some(mode.to_owned());
        } else if let Some(mode) = line.strip_prefix("new mode ") {
            file.new_mode = Some(mode.to_owned());
        } else if let Some(mode) = line.strip_prefix("deleted file mode ") {
            file.status = FileStatus::Deleted;
            file.old_mode = Some(mode.to_owned());
        } else if let Some(mode) = line.strip_prefix("new file mode ") {
            file.status = FileStatus::Added;
            file.new_mode = Some(mode.to_owned());
        } else if let Some(path) = line.strip_prefix("rename from ") {
            file.status = FileStatus::Renamed;
            file.old_path = Some(unquote(path));
        } else if let Some(path) = line.strip_prefix("rename to ") {
            file.new_path = Some(unquote(path));
        } else if let Some(path) = line.strip_prefix("copy from ") {
            file.status = FileStatus::Copied;
            file.old_path = Some(unquote(path));
        } else if let Some(path) = line.strip_prefix("copy to ") {
            file.new_path = Some(unquote(path));
        } else if let Some(index) = line.strip_prefix("index ") {
            let range = index.split(' ').next().unwrap_or_default();
            if let Some((old, new)) = range.split_once("..") {
                file.old_blob = Some(old.to_owned());
                file.new_blob = Some(new.to_owned());
            }
            if let Some(mode) = index.split(' ').nth(1) {
                file.old_mode.get_or_insert_with(|| mode.to_owned());
                file.new_mode.get_or_insert_with(|| mode.to_owned());
            }
        } else if line.starts_with("Binary files ") || line == "GIT binary patch" {
            file.binary = true;
        } else if let Some(path) = line.strip_prefix("--- ") {
            minus = Some(side_path(path, "a/"));
        } else if let Some(path) = line.strip_prefix("+++ ") {
            plus = Some(side_path(path, "b/"));
        }
        // similarity/dissimilarity index and anything unknown: ignored.
        i += 1;
    }
    match file.status {
        FileStatus::Added => {
            file.new_path = plus.flatten().or(git_new);
        }
        FileStatus::Deleted => {
            file.old_path = minus.flatten().or(git_old);
        }
        FileStatus::Renamed | FileStatus::Copied => {}
        FileStatus::Modified => {
            let path = plus.flatten().or(minus.flatten()).or(git_new).or(git_old);
            file.old_path.clone_from(&path);
            file.new_path = path;
        }
    }
    while i < lines.len() && lines[i].starts_with("@@ ") {
        let (hunk, next) = parse_hunk(lines, i)?;
        file.hunks.push(hunk);
        i = next;
    }
    Ok((file, i))
}

/// `--- a/path`, `--- "a/quoted"`, `--- /dev/null`; git appends a tab to names with spaces.
fn side_path(raw: &str, prefix: &str) -> Option<String> {
    let raw = raw.strip_suffix('\t').unwrap_or(raw);
    if raw == "/dev/null" {
        return None;
    }
    let path = unquote(raw);
    Some(path.strip_prefix(prefix).map(str::to_owned).unwrap_or(path))
}

/// Paths from `diff --git a/X b/Y` (fallback for mode-only changes without `---`/`+++`).
fn split_git_line(rest: &str) -> (Option<String>, Option<String>) {
    if rest.starts_with('"') {
        let (first, remainder) = take_quoted(rest);
        let second = remainder.trim_start();
        let second = if second.starts_with('"') {
            take_quoted(second).0
        } else {
            second.to_owned()
        };
        return (strip(first, "a/"), strip(second, "b/"));
    }
    // Unquoted: "a/X b/X" with equal halves (renames have their own header lines).
    let bytes = rest.len();
    if bytes % 2 == 1 {
        let half = bytes / 2;
        if rest.is_char_boundary(half) && rest.as_bytes().get(half) == Some(&b' ') {
            let (a, b) = (&rest[..half], &rest[half + 1..]);
            if a.strip_prefix("a/") == b.strip_prefix("b/") {
                return (strip(a.to_owned(), "a/"), strip(b.to_owned(), "b/"));
            }
        }
    }
    (None, None)
}

fn strip(path: String, prefix: &str) -> Option<String> {
    Some(path.strip_prefix(prefix).map(str::to_owned).unwrap_or(path))
}

/// C-style quoted path as git prints it (`"a/x\ty"`, octal escapes for bytes).
pub fn unquote(raw: &str) -> String {
    if raw.starts_with('"') {
        take_quoted(raw).0
    } else {
        raw.to_owned()
    }
}

fn take_quoted(raw: &str) -> (String, &str) {
    let mut bytes = Vec::new();
    let mut chars = raw.char_indices().skip(1);
    let mut end = raw.len();
    while let Some((index, ch)) = chars.next() {
        match ch {
            '"' => {
                end = index + 1;
                break;
            }
            '\\' => match chars.next() {
                Some((_, 'n')) => bytes.push(b'\n'),
                Some((_, 't')) => bytes.push(b'\t'),
                Some((_, 'r')) => bytes.push(b'\r'),
                Some((_, 'a')) => bytes.push(0x07),
                Some((_, 'b')) => bytes.push(0x08),
                Some((_, 'f')) => bytes.push(0x0c),
                Some((_, 'v')) => bytes.push(0x0b),
                Some((_, d)) if d.is_digit(8) => {
                    let mut value = d.to_digit(8).unwrap_or(0);
                    for _ in 0..2 {
                        if let Some((_, d)) = chars.next() {
                            value = value * 8 + d.to_digit(8).unwrap_or(0);
                        }
                    }
                    bytes.push(u8::try_from(value).unwrap_or(b'?'));
                }
                Some((_, other)) => {
                    let mut buf = [0; 4];
                    bytes.extend_from_slice(other.encode_utf8(&mut buf).as_bytes());
                }
                None => {}
            },
            other => {
                let mut buf = [0; 4];
                bytes.extend_from_slice(other.encode_utf8(&mut buf).as_bytes());
            }
        }
    }
    (String::from_utf8_lossy(&bytes).into_owned(), &raw[end..])
}

fn parse_hunk(lines: &[&str], start: usize) -> Result<(PatchHunk, usize), PatchError> {
    let header = lines[start].strip_suffix('\r').unwrap_or(lines[start]);
    let err = |reason| PatchError {
        line: start + 1,
        reason,
    };
    let body = header
        .strip_prefix("@@ -")
        .ok_or_else(|| err("bad hunk header"))?;
    let (ranges, section) = body
        .split_once(" @@")
        .ok_or_else(|| err("bad hunk header"))?;
    let (old, new) = ranges
        .split_once(" +")
        .ok_or_else(|| err("bad hunk header"))?;
    let (old_start, old_lines) = parse_range(old).ok_or_else(|| err("bad hunk range"))?;
    let (new_start, new_lines) = parse_range(new).ok_or_else(|| err("bad hunk range"))?;
    let mut hunk = PatchHunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        section: section.strip_prefix(' ').unwrap_or(section).to_owned(),
        lines: Vec::new(),
    };
    let (mut old_left, mut new_left) = (old_lines, new_lines);
    let mut i = start + 1;
    while i < lines.len() && (old_left > 0 || new_left > 0) {
        let line = lines[i];
        let (kind, text) = match line.as_bytes().first() {
            Some(b' ') => (LineKind::Ctx, &line[1..]),
            Some(b'-') => (LineKind::Del, &line[1..]),
            Some(b'+') => (LineKind::Add, &line[1..]),
            Some(b'\\') => {
                if let Some(last) = hunk.lines.last_mut() {
                    last.no_newline = true;
                }
                i += 1;
                continue;
            }
            // `diff.suppressBlankEmpty`: an empty context line has no leading space.
            None => (LineKind::Ctx, ""),
            Some(b'\r') if line == "\r" => (LineKind::Ctx, "\r"),
            Some(_) => return Err(err("hunk shorter than its header says")),
        };
        match kind {
            LineKind::Ctx => {
                old_left = old_left.saturating_sub(1);
                new_left = new_left.saturating_sub(1);
            }
            LineKind::Del => old_left = old_left.saturating_sub(1),
            LineKind::Add => new_left = new_left.saturating_sub(1),
        }
        hunk.lines.push(PatchLine {
            kind,
            text: text.to_owned(),
            no_newline: false,
        });
        i += 1;
    }
    // A trailing `\ No newline at end of file` after the last counted line.
    if lines.get(i).is_some_and(|line| line.starts_with('\\')) {
        if let Some(last) = hunk.lines.last_mut() {
            last.no_newline = true;
        }
        i += 1;
    }
    Ok((hunk, i))
}

/// "12,5" → (12, 5); "12" → (12, 1).
fn parse_range(range: &str) -> Option<(u32, u32)> {
    match range.split_once(',') {
        Some((start, count)) => Some((start.parse().ok()?, count.parse().ok()?)),
        None => Some((range.parse().ok()?, 1)),
    }
}

#[cfg(test)]
mod tests;
