//! "Wrote N% of the changed lines" (F-27.3): `git blame --line-porcelain -w -M` over the old
//! lines the branch changes or removes, read at the merge base with the target, as a share per
//! author e-mail. Lines the branch only adds have no author yet and count nowhere. The user's
//! own lines stay in the total but are not listed.

use std::collections::BTreeMap;

use crate::git::branch_info::branch_range;
use crate::git::diff::parse_patches;
use crate::git::error::GitError;
use crate::git::model::LineKind;
use crate::git::runner::Git;
use crate::os::process::Cancel;

/// One author's share of the changed old lines, rounded to whole percent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorShare {
    pub name: String,
    pub email: String,
    pub percent: u32,
}

/// The authors of the old lines an MR of the current branch into `target` changes, the largest
/// share first; `me` (an e-mail, any case) is left out. Empty when the branch changes no old
/// line or has no common history with the target.
pub async fn shares(
    git: &Git,
    target: &str,
    me: Option<&str>,
    cancel: &Cancel,
) -> Result<Vec<AuthorShare>, GitError> {
    let Some((base, head)) = branch_range(git, Some(target), cancel).await? else {
        return Ok(Vec::new());
    };
    let mut tally = Tally::default();
    for (path, ranges) in changed_old_lines(git, &base, &head, cancel).await? {
        let mut args: Vec<String> = ["blame", "--line-porcelain", "-w", "-M"]
            .iter()
            .map(|s| (*s).to_owned())
            .collect();
        for (start, end) in ranges {
            args.push("-L".to_owned());
            args.push(format!("{start},{end}"));
        }
        args.extend([base.clone(), "--".to_owned(), path]);
        let output = git.run(args, cancel).await?;
        tally.add_porcelain(&output.stdout);
    }
    Ok(tally.shares(me))
}

/// Old path and line ranges (1-based, inclusive) of the lines `base..head` removes or rewrites.
async fn changed_old_lines(
    git: &Git,
    base: &str,
    head: &str,
    cancel: &Cancel,
) -> Result<Vec<(String, Vec<(u32, u32)>)>, GitError> {
    let output = git
        .run(
            [
                "diff",
                "--no-color",
                "--no-ext-diff",
                "-M",
                "-U0",
                "--src-prefix=a/",
                "--dst-prefix=b/",
                base,
                head,
            ],
            cancel,
        )
        .await?;
    let mut files = Vec::new();
    for patch in parse_patches(&output.stdout)? {
        let Some(old) = patch.old_path.clone().filter(|_| !patch.binary) else {
            continue;
        };
        let mut ranges: Vec<(u32, u32)> = Vec::new();
        for hunk in &patch.hunks {
            for (number, _, line) in hunk.numbered() {
                let (Some(number), LineKind::Del) = (number, line.kind) else {
                    continue;
                };
                match ranges.last_mut() {
                    Some((_, end)) if *end + 1 == number => *end = number,
                    _ => ranges.push((number, number)),
                }
            }
        }
        if !ranges.is_empty() {
            files.push((old, ranges));
        }
    }
    Ok(files)
}

/// Lines per author e-mail (lower case), with the first name and spelling seen.
#[derive(Default)]
struct Tally {
    authors: BTreeMap<String, (String, String, u32)>,
    order: Vec<String>,
    total: u32,
}

impl Tally {
    /// Counts the `author-mail` of every line of a `--line-porcelain` answer.
    fn add_porcelain(&mut self, text: &str) {
        let mut name = String::new();
        for line in text.lines() {
            if let Some(author) = line.strip_prefix("author ") {
                author.clone_into(&mut name);
            } else if let Some(mail) = line.strip_prefix("author-mail ") {
                let email = mail.trim().trim_start_matches('<').trim_end_matches('>');
                self.add(&name, email);
            }
        }
    }

    fn add(&mut self, name: &str, email: &str) {
        let key = email.to_lowercase();
        self.total += 1;
        let entry = self.authors.entry(key.clone()).or_insert_with(|| {
            self.order.push(key);
            (name.to_owned(), email.to_owned(), 0)
        });
        entry.2 += 1;
    }

    fn shares(&self, me: Option<&str>) -> Vec<AuthorShare> {
        let me = me.map(str::to_lowercase);
        let mut rows: Vec<(u32, AuthorShare)> = self
            .order
            .iter()
            .filter(|key| me.as_deref() != Some(key.as_str()))
            .filter_map(|key| self.authors.get(key))
            .map(|(name, email, lines)| {
                (
                    *lines,
                    AuthorShare {
                        name: name.clone(),
                        email: email.clone(),
                        percent: percent(*lines, self.total),
                    },
                )
            })
            .collect();
        // Stable: equal shares keep the order they were first seen in.
        rows.sort_by_key(|r| std::cmp::Reverse(r.0));
        rows.into_iter().map(|(_, share)| share).collect()
    }
}

/// `part` of `total` in whole percent, half up.
fn percent(part: u32, total: u32) -> u32 {
    if total == 0 {
        return 0;
    }
    let scaled = u64::from(part) * 100 + u64::from(total) / 2;
    u32::try_from(scaled / u64::from(total)).unwrap_or(100)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f27_3_porcelain_counts_lines_per_e_mail() {
        let text = "abc 1 1 2\nauthor Ola M.\nauthor-mail <ola.m@firma.example>\n\tx\n\
                    abc 2 2\nauthor Ola M.\nauthor-mail <OLA.M@firma.example>\n\ty\n\
                    def 3 3 1\nauthor Ja\nauthor-mail <ja@firma.example>\n\tz\n";
        let mut tally = Tally::default();
        tally.add_porcelain(text);
        let shares = tally.shares(Some("JA@firma.example"));
        assert_eq!(
            shares,
            [AuthorShare {
                name: "Ola M.".into(),
                email: "ola.m@firma.example".into(),
                percent: 67,
            }]
        );
    }

    #[test]
    fn f27_3_percent_rounds_half_up() {
        assert_eq!(percent(4, 7), 57);
        assert_eq!(percent(3, 7), 43);
        assert_eq!(percent(1, 8), 13);
        assert_eq!(percent(0, 0), 0);
    }
}
