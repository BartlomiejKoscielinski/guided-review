//! `git status --porcelain=v2 -z --branch --untracked-files=all` (docs/05 › Local status).

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Status {
    /// `None` on a detached HEAD.
    pub branch: Option<String>,
    /// `None` before the first commit.
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub entries: Vec<StatusEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusEntry {
    pub path: String,
    /// Source of a rename or copy in the index.
    pub orig_path: Option<String>,
    /// Index vs HEAD (`X`), `.` when unchanged.
    pub index: char,
    /// Working tree vs index (`Y`), `.` when unchanged.
    pub worktree: char,
    pub kind: EntryKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    Changed,
    Renamed,
    Unmerged,
    Untracked,
}

/// Parses the `-z` output; `None` when it isn't porcelain v2.
pub fn parse(text: &str) -> Option<Status> {
    let mut status = Status::default();
    let mut tokens = text.split('\0').filter(|t| !t.is_empty());
    while let Some(token) = tokens.next() {
        if let Some(header) = token.strip_prefix("# ") {
            parse_header(header, &mut status);
            continue;
        }
        let (kind_char, rest) = token.split_at(1);
        let rest = rest.strip_prefix(' ')?;
        let entry = match kind_char {
            "1" => {
                // XY sub mH mI mW hH hI path
                let fields: Vec<&str> = rest.splitn(8, ' ').collect();
                changed(fields.first()?, fields.get(7)?, None, EntryKind::Changed)?
            }
            "2" => {
                // XY sub mH mI mW hH hI Xscore path \0 origPath
                let fields: Vec<&str> = rest.splitn(9, ' ').collect();
                let orig = tokens.next()?.to_owned();
                changed(
                    fields.first()?,
                    fields.get(8)?,
                    Some(orig),
                    EntryKind::Renamed,
                )?
            }
            "u" => {
                // XY sub m1 m2 m3 mW h1 h2 h3 path
                let fields: Vec<&str> = rest.splitn(10, ' ').collect();
                changed(fields.first()?, fields.get(9)?, None, EntryKind::Unmerged)?
            }
            "?" => StatusEntry {
                path: rest.to_owned(),
                orig_path: None,
                index: '?',
                worktree: '?',
                kind: EntryKind::Untracked,
            },
            "!" => continue,
            _ => return None,
        };
        status.entries.push(entry);
    }
    Some(status)
}

fn changed(xy: &str, path: &str, orig: Option<String>, kind: EntryKind) -> Option<StatusEntry> {
    let mut chars = xy.chars();
    Some(StatusEntry {
        index: chars.next()?,
        worktree: chars.next()?,
        path: path.to_owned(),
        orig_path: orig,
        kind,
    })
}

fn parse_header(header: &str, status: &mut Status) {
    let (key, value) = header.split_once(' ').unwrap_or((header, ""));
    match key {
        "branch.oid" if value != "(initial)" => status.head = Some(value.to_owned()),
        "branch.head" if value != "(detached)" => status.branch = Some(value.to_owned()),
        "branch.upstream" => status.upstream = Some(value.to_owned()),
        "branch.ab" => {
            for part in value.split(' ') {
                if let Some(n) = part.strip_prefix('+') {
                    status.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    status.behind = n.parse().unwrap_or(0);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_headers_and_all_entry_kinds() {
        let text = "# branch.oid 0123456789abcdef0123456789abcdef01234567\0\
# branch.head chore/compiled-bindings\0# branch.upstream origin/chore/compiled-bindings\0\
# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 aaa aaa src/A b.cs\0\
1 A. N... 000000 100644 100644 000 bbb new ż.cs\0\
2 R. N... 100644 100644 100644 ccc ccc R100 moved/B.cs\0old/B.cs\0\
u UU N... 100644 100644 100644 100644 d e f conflict.cs\0\
? untracked ą.txt\0! ignored.log\0";
        let s = parse(text).unwrap();
        assert_eq!(s.branch.as_deref(), Some("chore/compiled-bindings"));
        assert_eq!(s.head.as_deref().map(str::len), Some(40));
        assert_eq!(
            s.upstream.as_deref(),
            Some("origin/chore/compiled-bindings")
        );
        assert_eq!((s.ahead, s.behind), (2, 1));
        assert_eq!(s.entries.len(), 5);
        assert_eq!(s.entries[0].path, "src/A b.cs");
        assert_eq!((s.entries[0].index, s.entries[0].worktree), ('.', 'M'));
        assert_eq!(s.entries[2].kind, EntryKind::Renamed);
        assert_eq!(s.entries[2].orig_path.as_deref(), Some("old/B.cs"));
        assert_eq!(s.entries[3].kind, EntryKind::Unmerged);
        assert_eq!(s.entries[4].path, "untracked ą.txt");
    }

    #[test]
    fn unborn_and_detached() {
        let s = parse("# branch.oid (initial)\0# branch.head main\0").unwrap();
        assert_eq!(s.head, None);
        let s = parse("# branch.oid abc\0# branch.head (detached)\0").unwrap();
        assert_eq!(s.branch, None);
    }
}
