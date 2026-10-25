//! The reviewer list of S-11 (F-27.3, M7 decision 18): at most three project members, never me
//! or a bot, ranked code owner > blame share > review history, each once with the strongest
//! reason. A blame author is matched to a member by name, then by the e-mail's local part as the
//! username; whoever matches no member is dropped (a wrong match is worse than none).

use serde::Serialize;
use ts_rs::TS;

use super::blame_share::AuthorShare;
use super::codeowners::Owned;
use super::history::{Area, ReviewCount};
use crate::gitlab::members::{Member, is_bot};

/// How many people S-11 suggests.
pub const MAX: usize = 3;

/// One suggested reviewer with the reason S-11 shows under the name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "ReviewerSuggestion")]
pub struct Suggestion {
    #[ts(type = "number")]
    pub id: u64,
    pub username: String,
    pub name: String,
    pub reason: String,
}

/// What the suggestions are built from.
#[derive(Debug, Clone, Default)]
pub struct Sources {
    /// The signed-in username.
    pub me: String,
    /// The project members the people are matched to.
    pub members: Vec<Member>,
    /// The code-owner rules of the changed files, the most relevant first.
    pub owners: Vec<Owned>,
    pub blame: Vec<AuthorShare>,
    pub reviewed: Vec<ReviewCount>,
    pub area: Option<Area>,
}

impl Sources {
    fn member(&self, username: &str) -> Option<&Member> {
        self.members
            .iter()
            .find(|m| m.username.eq_ignore_ascii_case(username))
    }

    /// The member a blame author is: by name, then by the e-mail's local part.
    fn author(&self, share: &AuthorShare) -> Option<&Member> {
        let name = share.name.trim().to_lowercase();
        self.members
            .iter()
            .find(|m| !name.is_empty() && m.name.trim().to_lowercase() == name)
            .or_else(|| {
                let local = share.email.split_once('@').map(|(l, _)| l)?;
                self.member(local)
            })
    }

    fn excluded(&self, member: &Member) -> bool {
        member.username.eq_ignore_ascii_case(&self.me) || is_bot(&member.username)
    }
}

struct List<'a> {
    sources: &'a Sources,
    picked: Vec<Suggestion>,
}

impl List<'_> {
    fn offer(&mut self, member: Option<&Member>, reason: impl FnOnce() -> String) {
        let Some(member) = member else { return };
        if self.picked.len() >= MAX
            || self.sources.excluded(member)
            || self.picked.iter().any(|s| s.id == member.id)
        {
            return;
        }
        self.picked.push(Suggestion {
            id: member.id,
            username: member.username.clone(),
            name: member.name.clone(),
            reason: reason(),
        });
    }
}

/// The suggestions, best first.
pub fn build(sources: &Sources) -> Vec<Suggestion> {
    let mut list = List {
        sources,
        picked: Vec::new(),
    };
    for owned in &sources.owners {
        for user in &owned.users {
            list.offer(sources.member(user), || {
                format!("Code owner of {}", owned.pattern)
            });
        }
    }
    // Shares of one member (several e-mails or spellings) add up.
    let mut shares: Vec<(&Member, u32)> = Vec::new();
    for share in &sources.blame {
        let Some(member) = sources.author(share) else {
            continue;
        };
        match shares.iter_mut().find(|(m, _)| m.id == member.id) {
            Some((_, percent)) => *percent = percent.saturating_add(share.percent),
            None => shares.push((member, share.percent)),
        }
    }
    shares.sort_by_key(|s| std::cmp::Reverse(s.1));
    for (member, percent) in shares.into_iter().filter(|(_, p)| *p > 0) {
        let percent = percent.min(100);
        list.offer(Some(member), || {
            format!("Wrote {percent}% of the changed lines")
        });
    }
    if let Some(area) = &sources.area {
        let mut reviewed: Vec<&ReviewCount> = sources.reviewed.iter().collect();
        reviewed.sort_by_key(|c| std::cmp::Reverse(c.count));
        for count in reviewed.into_iter().filter(|c| c.count > 0) {
            list.offer(sources.member(&count.username), || {
                let mrs = if count.count == 1 { "MR" } else { "MRs" };
                format!("Reviewed {} {mrs} in {} this month", count.count, area.name)
            });
        }
    }
    list.picked
}
