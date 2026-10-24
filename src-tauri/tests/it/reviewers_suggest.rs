//! Who S-11 suggests as reviewers (F-27.3, M7 decisions 17 and 18): at most 3 people, me and bots
//! excluded, ranked code owner > blame share > review history, each with its strongest reason, a
//! blame author matched to a project member by name and then by the e-mail's local part, and an
//! author who matches nobody dropped. The area of the change and the review counts of the last
//! 30 days come from the same module.
#![allow(clippy::unwrap_used, reason = "tests")]

use guided_review_lib::gitlab::members::Member;
use guided_review_lib::reviewers::blame_share::AuthorShare;
use guided_review_lib::reviewers::codeowners::Owned;
use guided_review_lib::reviewers::history::{
    Area, MergedMr, ReviewCount, area_of, reviewed_counts,
};
use guided_review_lib::reviewers::suggest::{Sources, build};

fn member(id: u64, username: &str, name: &str) -> Member {
    Member {
        id,
        username: username.to_owned(),
        name: name.to_owned(),
    }
}

fn team() -> Vec<Member> {
    vec![
        member(1, "bartek.k", "Bartek K."),
        member(2, "marta.k", "Marta K."),
        member(3, "ola.m", "Ola M."),
        member(4, "piotr.s", "Piotr S."),
        member(5, "anna.k", "Anna K."),
        member(6, "project_7_bot_3f9a1c", "Deploy bot"),
        member(7, "renovate-bot", "Renovate"),
    ]
}

fn views() -> Area {
    Area {
        dir: "src/App/Views".to_owned(),
        name: "Views".to_owned(),
    }
}

fn owned(pattern: &str, users: &[&str]) -> Owned {
    Owned {
        pattern: pattern.to_owned(),
        users: users.iter().map(|u| (*u).to_owned()).collect(),
    }
}

fn share(name: &str, email: &str, percent: u32) -> AuthorShare {
    AuthorShare {
        name: name.to_owned(),
        email: email.to_owned(),
        percent,
    }
}

fn reviewed(username: &str, count: u32) -> ReviewCount {
    ReviewCount {
        username: username.to_owned(),
        count,
    }
}

fn sources() -> Sources {
    Sources {
        me: "bartek.k".to_owned(),
        members: team(),
        owners: Vec::new(),
        blame: Vec::new(),
        reviewed: Vec::new(),
        area: Some(views()),
    }
}

/// `(username, reason)` of the suggestions, in order.
fn picked(sources: &Sources) -> Vec<(String, String)> {
    build(sources)
        .into_iter()
        .map(|s| (s.username, s.reason))
        .collect()
}

fn pairs(rows: &[(&str, &str)]) -> Vec<(String, String)> {
    rows.iter()
        .map(|(u, r)| ((*u).to_owned(), (*r).to_owned()))
        .collect()
}

#[test]
fn f27_3_suggestions_carry_the_reasons_of_the_design() {
    let s = Sources {
        owners: vec![owned("src/App/Views/", &["marta.k"])],
        blame: vec![share("Ola M.", "ola.m@firma.example", 58)],
        reviewed: vec![reviewed("piotr.s", 4)],
        ..sources()
    };
    assert_eq!(
        picked(&s),
        pairs(&[
            ("marta.k", "Code owner of src/App/Views/"),
            ("ola.m", "Wrote 58% of the changed lines"),
            ("piotr.s", "Reviewed 4 MRs in Views this month"),
        ])
    );
    let first = build(&s).remove(0);
    assert_eq!((first.id, first.name.as_str()), (2, "Marta K."));
}

#[test]
fn f27_3_suggestions_one_review_reads_in_the_singular() {
    let s = Sources {
        reviewed: vec![reviewed("piotr.s", 1)],
        ..sources()
    };
    assert_eq!(
        picked(&s),
        pairs(&[("piotr.s", "Reviewed 1 MR in Views this month")])
    );
}

#[test]
fn f27_3_suggestions_at_most_three_ranked_owner_then_blame_then_history() {
    let s = Sources {
        // Listed out of order on purpose: the share and the count rank, not the list.
        owners: vec![owned("src/", &["anna.k", "marta.k"])],
        blame: vec![
            share("Ola M.", "ola.m@firma.example", 20),
            share("Piotr S.", "piotr.s@firma.example", 50),
        ],
        reviewed: vec![reviewed("anna.k", 9)],
        ..sources()
    };
    // Two owners fill two places, the larger share takes the last one; nobody else fits.
    assert_eq!(
        picked(&s),
        pairs(&[
            ("anna.k", "Code owner of src/"),
            ("marta.k", "Code owner of src/"),
            ("piotr.s", "Wrote 50% of the changed lines"),
        ])
    );
    let s = Sources {
        blame: vec![
            share("Ola M.", "ola.m@firma.example", 20),
            share("Piotr S.", "piotr.s@firma.example", 50),
        ],
        reviewed: vec![reviewed("anna.k", 3), reviewed("marta.k", 9)],
        ..sources()
    };
    assert_eq!(
        picked(&s),
        pairs(&[
            ("piotr.s", "Wrote 50% of the changed lines"),
            ("ola.m", "Wrote 20% of the changed lines"),
            ("marta.k", "Reviewed 9 MRs in Views this month"),
        ])
    );
}

#[test]
fn f27_3_suggestions_a_person_appears_once_with_the_strongest_reason() {
    let s = Sources {
        owners: vec![owned("src/App/Views/", &["ola.m"])],
        blame: vec![
            share("Ola M.", "ola.m@firma.example", 58),
            share("Piotr S.", "piotr.s@firma.example", 30),
        ],
        reviewed: vec![reviewed("ola.m", 7), reviewed("piotr.s", 2)],
        ..sources()
    };
    assert_eq!(
        picked(&s),
        pairs(&[
            ("ola.m", "Code owner of src/App/Views/"),
            ("piotr.s", "Wrote 30% of the changed lines"),
        ])
    );
}

#[test]
fn f27_3_suggestions_leave_out_me_and_bots() {
    let s = Sources {
        owners: vec![owned(
            "src/",
            &["bartek.k", "project_7_bot_3f9a1c", "marta.k"],
        )],
        // My own commits under the name and the e-mail of my account.
        blame: vec![
            share("Bartek K.", "bartek.k@firma.example", 70),
            share("Renovate", "renovate-bot@firma.example", 20),
        ],
        reviewed: vec![reviewed("renovate-bot", 30), reviewed("bartek.k", 12)],
        ..sources()
    };
    assert_eq!(picked(&s), pairs(&[("marta.k", "Code owner of src/")]));
}

#[test]
fn f27_3_suggestions_drop_whoever_is_no_project_member() {
    let s = Sources {
        // A code owner and a reviewer who are no members, and a blame author who matches nobody.
        owners: vec![owned("src/", &["nie.ma.go"])],
        blame: vec![
            share("Nieznany Autor", "nikt@firma.example", 80),
            share("Ola M.", "ola.m@firma.example", 10),
        ],
        reviewed: vec![reviewed("ktos.obcy", 8)],
        ..sources()
    };
    assert_eq!(
        picked(&s),
        pairs(&[("ola.m", "Wrote 10% of the changed lines")])
    );
}

#[test]
fn f27_3_suggestions_match_a_blame_author_by_name_then_by_e_mail_local_part() {
    // The name wins over an e-mail that points at somebody else.
    let s = Sources {
        blame: vec![share("Ola M.", "piotr.s@firma.example", 40)],
        ..sources()
    };
    assert_eq!(
        picked(&s),
        pairs(&[("ola.m", "Wrote 40% of the changed lines")])
    );
    // No member of that name: the part of the e-mail before the @ is the username.
    let s = Sources {
        blame: vec![share("Aleksandra Majewska", "ola.m@firma.example", 40)],
        ..sources()
    };
    assert_eq!(
        picked(&s),
        pairs(&[("ola.m", "Wrote 40% of the changed lines")])
    );
}

#[test]
fn f27_3_suggestions_add_up_the_shares_of_one_person_with_two_e_mails() {
    let s = Sources {
        blame: vec![
            share("Ola M.", "ola.m@firma.example", 40),
            share("Ola Majewska", "ola.m@dawny.example", 30),
        ],
        ..sources()
    };
    assert_eq!(
        picked(&s),
        pairs(&[("ola.m", "Wrote 70% of the changed lines")])
    );
}

#[test]
fn f27_3_suggestions_without_an_area_have_no_history_reason() {
    let s = Sources {
        reviewed: vec![reviewed("piotr.s", 4)],
        area: None,
        ..sources()
    };
    assert!(build(&s).is_empty());
    assert!(build(&sources()).is_empty());
}

fn changed(rows: &[(&str, u32)]) -> Vec<(String, u32)> {
    rows.iter().map(|(p, n)| ((*p).to_owned(), *n)).collect()
}

#[test]
fn f27_3_area_is_the_folder_with_most_changed_lines() {
    let area = area_of(&changed(&[
        ("src/App/Views/Main.xaml", 30),
        ("src/App/Views/Other.xaml", 25),
        ("src/App/Models/Item.cs", 40),
        ("README.md", 100),
    ]))
    .unwrap();
    assert_eq!(
        (area.dir.as_str(), area.name.as_str()),
        ("src/App/Views", "Views")
    );

    let area = area_of(&changed(&[("Widoki/Żółć/Lista ąę.cs", 3), ("A.cs", 9)])).unwrap();
    assert_eq!(
        (area.dir.as_str(), area.name.as_str()),
        ("Widoki/Żółć", "Żółć")
    );

    // A tie goes to the folder that sorts first; files at the root have no area.
    let area = area_of(&changed(&[("b/X.cs", 5), ("a/Y.cs", 5)])).unwrap();
    assert_eq!(area.dir, "a");
    assert!(area_of(&changed(&[("README.md", 10)])).is_none());
    assert!(area_of(&[]).is_none());
}

fn merged(reviewers: &[&str], paths: &[&str]) -> MergedMr {
    MergedMr {
        reviewers: reviewers.iter().map(|r| (*r).to_owned()).collect(),
        paths: paths.iter().map(|p| (*p).to_owned()).collect(),
    }
}

#[test]
fn f27_3_history_counts_merged_mrs_per_reviewer_under_the_area() {
    let mrs = vec![
        merged(&["piotr.s", "ola.m"], &["src/App/Views/A.xaml"]),
        // Deeper in the folder, two files in the area, a reviewer listed twice: one MR each.
        merged(
            &["piotr.s", "piotr.s"],
            &["src/App/Views/Sub/B.xaml", "src/App/Views/C.xaml", "x.md"],
        ),
        // A folder that only starts with the same letters, and another folder: not in the area.
        merged(&["piotr.s"], &["src/App/ViewsExtra/D.xaml"]),
        merged(&["ola.m"], &["src/App/Models/E.cs"]),
        merged(&["piotr.s"], &["src/App/Views/F.xaml"]),
        // Nobody reviewed it.
        merged(&[], &["src/App/Views/G.xaml"]),
    ];
    let counts: Vec<(String, u32)> = reviewed_counts(&mrs, &views())
        .into_iter()
        .map(|c| (c.username, c.count))
        .collect();
    assert_eq!(counts, [("piotr.s".to_owned(), 3), ("ola.m".to_owned(), 1)]);
    assert!(reviewed_counts(&[], &views()).is_empty());
}
