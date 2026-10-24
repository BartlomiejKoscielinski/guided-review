//! Code owners for the reviewer suggestions (F-27.3): GitLab's CODEOWNERS syntax, read from the
//! target branch on `origin`, never from the working tree. Comments, sections with default
//! owners (`[Name][N] @user`, `^[Optional]`), `*`, `?`, `**`, a leading `/` (anchored at the
//! root; without it the pattern matches at any depth) and a trailing `/` (the folder and all
//! below it). As in GitLab, the last matching rule wins within a section (also when it names
//! nobody the app can add), and a path matched in several sections has the owners of each of
//! them (one code-owner approval rule per section). Rules before the first header form the
//! default section; headers with the same name (any case) are one section. Only `@user` owners
//! count: groups (`@group/sub`), roles (`@@maintainer`) and e-mail addresses are skipped.

use crate::git::error::GitError;
use crate::git::refs;
use crate::git::runner::Git;
use crate::os::process::Cancel;

/// Where GitLab looks for the file, in its order; the first one found is used.
pub const LOCATIONS: [&str; 3] = ["CODEOWNERS", "docs/CODEOWNERS", ".gitlab/CODEOWNERS"];

/// The rule that owns a path: its pattern as written without the leading `/`, and its users.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Owned {
    pub pattern: String,
    pub users: Vec<String>,
}

#[derive(Debug, Clone)]
struct Rule {
    /// As written, without the leading `/`.
    pattern: String,
    /// Glob segments, `**` first for a pattern that isn't anchored.
    segments: Vec<String>,
    /// A trailing `/`: only folders match, so the rule takes what is below them.
    folder: bool,
    users: Vec<String>,
}

impl Rule {
    fn matches(&self, path: &str) -> bool {
        let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
        // The path itself or one of its folders; for a folder rule only the folders.
        let longest = if self.folder {
            parts.len().saturating_sub(1)
        } else {
            parts.len()
        };
        (1..=longest).any(|len| match_segments(&self.segments, &parts[..len]))
    }
}

/// The rules of one section, in file order.
#[derive(Debug, Clone)]
struct Section {
    /// The name in lower case; empty for the default section before the first header.
    key: String,
    rules: Vec<Rule>,
}

/// A parsed CODEOWNERS file: its sections in the order they first appear.
#[derive(Debug, Clone, Default)]
pub struct CodeOwners {
    sections: Vec<Section>,
}

impl CodeOwners {
    pub fn parse(text: &str) -> Self {
        let mut sections: Vec<Section> = Vec::new();
        let mut current = 0;
        let mut defaults: Vec<String> = Vec::new();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((name, owners)) = section_header(line) {
                current = section_index(&mut sections, &name.to_lowercase());
                defaults = owners;
                continue;
            }
            let mut tokens = tokens(line).into_iter();
            let Some(raw) = tokens.next() else { continue };
            let owners: Vec<String> = tokens.collect();
            let users = if owners.is_empty() {
                defaults.clone()
            } else {
                users_of(&owners)
            };
            if sections.is_empty() {
                section_index(&mut sections, "");
            }
            if let Some(section) = sections.get_mut(current) {
                section.rules.push(rule(&raw, users));
            }
        }
        Self { sections }
    }

    /// The owners of `path` (relative to the repository root, `/`-separated): the last matching
    /// rule of each section that has one, in section order; empty when no rule matches.
    pub fn owners_in_sections(&self, path: &str) -> Vec<Owned> {
        self.sections
            .iter()
            .filter_map(|section| section.rules.iter().rev().find(|rule| rule.matches(path)))
            .map(|rule| Owned {
                pattern: rule.pattern.clone(),
                users: rule.users.clone(),
            })
            .collect()
    }

    /// The matching rule of the last section that has one (in a file without sections, the
    /// last matching rule); `None` when no rule matches. Every section's owner:
    /// [`Self::owners_in_sections`].
    pub fn owners_of(&self, path: &str) -> Option<Owned> {
        self.owners_in_sections(path).pop()
    }
}

/// The section named `key`, added at the end when the file had none of that name yet.
fn section_index(sections: &mut Vec<Section>, key: &str) -> usize {
    if let Some(index) = sections.iter().position(|s| s.key == key) {
        return index;
    }
    sections.push(Section {
        key: key.to_owned(),
        rules: Vec::new(),
    });
    sections.len() - 1
}

/// The name and default owners of a section header (`[Name]`, `^[Name]`, `[Name][2] @a @b`),
/// or `None` when the line is no header.
fn section_header(line: &str) -> Option<(String, Vec<String>)> {
    let rest = line.strip_prefix('^').unwrap_or(line).strip_prefix('[')?;
    let (name, mut rest) = rest.split_once(']')?;
    if let Some(after) = rest.strip_prefix('[')
        && let Some((count, tail)) = after.split_once(']')
        && count.chars().all(|c| c.is_ascii_digit())
    {
        rest = tail;
    }
    let owners: Vec<String> = rest.split_whitespace().map(str::to_owned).collect();
    Some((name.trim().to_owned(), users_of(&owners)))
}

/// Splits on whitespace that isn't escaped with `\`; `\ ` and `\#` become the plain character.
fn tokens(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => match chars.next() {
                Some(next @ (' ' | '\t' | '#')) => current.push(next),
                Some(next) => {
                    current.push('\\');
                    current.push(next);
                }
                None => current.push('\\'),
            },
            c if c.is_whitespace() => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// The `@user` entries of an owner list, without the `@`.
fn users_of(owners: &[String]) -> Vec<String> {
    owners
        .iter()
        .filter_map(|owner| owner.strip_prefix('@'))
        .filter(|name| {
            !name.is_empty()
                && name
                    .chars()
                    .all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_'))
        })
        .map(str::to_owned)
        .collect()
}

fn rule(raw: &str, users: Vec<String>) -> Rule {
    let anchored = raw.starts_with('/');
    let pattern = raw.trim_start_matches('/').to_owned();
    let folder = pattern.ends_with('/');
    let mut segments: Vec<String> = Vec::new();
    if !anchored {
        segments.push("**".to_owned());
    }
    segments.extend(
        pattern
            .split('/')
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
    );
    // `/` alone or `**` alone: everything.
    if segments.iter().all(|s| s == "**") {
        return Rule {
            pattern,
            segments: vec!["**".to_owned(), "*".to_owned()],
            folder: false,
            users,
        };
    }
    Rule {
        pattern,
        segments,
        folder,
        users,
    }
}

/// Glob segments against path segments; `**` takes any number of segments.
fn match_segments(pattern: &[String], path: &[&str]) -> bool {
    match pattern.split_first() {
        None => path.is_empty(),
        Some((first, rest)) if first == "**" => {
            (0..=path.len()).any(|skip| match_segments(rest, &path[skip..]))
        }
        Some((first, rest)) => match path.split_first() {
            Some((name, tail)) => match_name(first, name) && match_segments(rest, tail),
            None => false,
        },
    }
}

/// One segment: `*` any run of characters, `?` one character, the rest literally.
fn match_name(pattern: &str, name: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let name: Vec<char> = name.chars().collect();
    let (mut p, mut n) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while n < name.len() {
        match pattern.get(p) {
            Some('*') => {
                star = Some((p, n));
                p += 1;
            }
            Some(&c) if c == '?' || c == name[n] => {
                p += 1;
                n += 1;
            }
            _ => match star {
                Some((sp, sn)) => {
                    p = sp + 1;
                    n = sn + 1;
                    star = Some((sp, sn + 1));
                }
                None => return false,
            },
        }
    }
    pattern[p..].iter().all(|c| *c == '*')
}

/// The CODEOWNERS of `target` (a branch on `origin`, with or without `origin/`): the first of
/// [`LOCATIONS`] it carries. Empty without such a branch or file.
pub async fn load(git: &Git, target: &str, cancel: &Cancel) -> Result<CodeOwners, GitError> {
    let name = target.strip_prefix("origin/").unwrap_or(target);
    if !refs::is_branch_name(name) {
        return Ok(CodeOwners::default());
    }
    let Some(commit) =
        refs::verify_commit(git, &format!("refs/remotes/origin/{name}"), cancel).await?
    else {
        return Ok(CodeOwners::default());
    };
    for location in LOCATIONS {
        let spec = git.spec([
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            &format!("{commit}:{location}"),
        ]);
        let found = git.run_spec(spec, cancel, &[0, 1, 128]).await?;
        let blob = found.stdout.trim();
        if found.code != Some(0) || blob.is_empty() {
            continue;
        }
        let text = git.run(["cat-file", "blob", blob], cancel).await?;
        return Ok(CodeOwners::parse(&text.stdout));
    }
    Ok(CodeOwners::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f27_3_name_globs() {
        assert!(match_name("*.cs", "Zażółć.cs"));
        assert!(match_name("a?c", "abc"));
        assert!(match_name("*", "x"));
        assert!(!match_name("*.cs", "a.csx"));
        assert!(!match_name("a?c", "ac"));
    }

    #[test]
    fn f27_3_a_slash_alone_owns_everything() {
        let owners = CodeOwners::parse("/ @root.u\n");
        assert_eq!(owners.owners_of("a/b.cs").unwrap().users, ["root.u"]);
    }

    #[test]
    fn f27_3_escaped_spaces_stay_in_the_pattern() {
        let owners = CodeOwners::parse("/Moje\\ pliki/ @ola.m\n");
        assert_eq!(
            owners.owners_of("Moje pliki/a.cs").unwrap().users,
            ["ola.m"]
        );
    }

    fn owned(owners: &CodeOwners, path: &str) -> Vec<(String, Vec<String>)> {
        owners
            .owners_in_sections(path)
            .into_iter()
            .map(|o| (o.pattern, o.users))
            .collect()
    }

    fn own(pattern: &str, users: &[&str]) -> (String, Vec<String>) {
        (
            pattern.to_owned(),
            users.iter().map(|u| (*u).to_owned()).collect(),
        )
    }

    #[test]
    fn f27_3_sections_each_give_their_last_match() {
        let owners = CodeOwners::parse(
            "* @fallback.u\n[Views] @marta.k\n/src/App/Views/\n/src/App/Views/Special.xaml @ola.m\n\n^[QA]\n*.xaml @qa.lead\n\n[views]\n/src/App/Views/Old/ @piotr.s\n",
        );
        // The default section, Views and QA each own Main.xaml: the later QA rule keeps Marta.
        assert_eq!(
            owned(&owners, "src/App/Views/Main.xaml"),
            [
                own("*", &["fallback.u"]),
                own("src/App/Views/", &["marta.k"]),
                own("*.xaml", &["qa.lead"]),
            ]
        );
        // The last match wins within a section; a header repeated in another case is the same
        // section, so its later rule wins there.
        assert_eq!(
            owned(&owners, "src/App/Views/Old/A.xaml"),
            [
                own("*", &["fallback.u"]),
                own("src/App/Views/Old/", &["piotr.s"]),
                own("*.xaml", &["qa.lead"]),
            ]
        );
        assert_eq!(
            owned(&owners, "src/App/Views/Special.xaml")[1],
            own("src/App/Views/Special.xaml", &["ola.m"])
        );
        assert_eq!(owned(&owners, "a.cs"), [own("*", &["fallback.u"])]);
        assert!(
            CodeOwners::parse("[Empty]\n")
                .owners_in_sections("a.cs")
                .is_empty()
        );
    }
}
