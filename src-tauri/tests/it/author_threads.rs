//! F-26.1 below the Tauri layer: the discussions of my own MR become the thread list of S-10
//! (M7 decision 5). Question = an unresolved thread whose first note ends a sentence with "?";
//! Change requested = any other unresolved thread; Fix proposed = an open proposal; Fixed
//! locally · not pushed = a queued reply; Replied = my reply on a change thread; Answered = my
//! reply on a question; resolved threads fold into "N resolved earlier". "N threads to answer"
//! counts unresolved threads whose last note is not mine. Synthetic data only (ADR-019).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "tests")]

use std::collections::HashSet;

use guided_review_lib::gitlab::account::GitlabUser;
use guided_review_lib::gitlab::discussions::{Thread, ThreadNote, ThreadPosition};
use guided_review_lib::review::author_threads::{self, ThreadKind, ThreadStatus};
use serde_json::json;

/// The signed-in user: the author of the MR.
const ME: &str = "bartek.k";
const FILE: &str = "src/App/Zażółć/Upload Worker.cs";

fn user(username: &str, name: &str) -> GitlabUser {
    GitlabUser {
        username: username.to_owned(),
        name: name.to_owned(),
    }
}

fn note(id: u64, who: GitlabUser, body: &str) -> ThreadNote {
    ThreadNote {
        id,
        author: who,
        body: body.to_owned(),
        created_at: "2026-10-20T08:00:00Z".to_owned(),
    }
}

fn marta() -> GitlabUser {
    user("marta.k", "Marta K.")
}

fn me() -> GitlabUser {
    user(ME, "Bartek K.")
}

fn position(new_line: Option<u32>, old_line: Option<u32>) -> ThreadPosition {
    ThreadPosition {
        old_path: FILE.to_owned(),
        new_path: FILE.to_owned(),
        old_line,
        new_line,
        head_sha: "a".repeat(40),
        base_sha: "b".repeat(40),
    }
}

/// An unresolved diff thread at `FILE:46`; `notes` are (mine, body) in order, the others are
/// Marta's.
fn thread(id: &str, notes: &[(bool, &str)]) -> Thread {
    Thread {
        id: id.to_owned(),
        resolvable: true,
        resolved: false,
        position: Some(position(Some(46), None)),
        notes: notes
            .iter()
            .zip(1_u64..)
            .map(|((mine, body), n)| note(n, if *mine { me() } else { marta() }, body))
            .collect(),
        outdated: false,
        placed_line: None,
    }
}

fn resolved(id: &str, body: &str) -> Thread {
    Thread {
        resolved: true,
        ..thread(id, &[(false, body)])
    }
}

fn none() -> HashSet<String> {
    HashSet::new()
}

fn ids(of: &[&str]) -> HashSet<String> {
    of.iter().map(|s| (*s).to_owned()).collect()
}

/// The status of the one listed thread.
fn status_of(
    threads: &[Thread],
    proposals: &HashSet<String>,
    queued: &HashSet<String>,
) -> ThreadStatus {
    let list = author_threads::of(threads, ME, proposals, queued);
    assert_eq!(list.threads.len(), 1, "one unresolved thread is listed");
    list.threads[0].status
}

fn status(threads: &[Thread]) -> ThreadStatus {
    status_of(threads, &none(), &none())
}

fn kind_of_first(body: &str) -> ThreadKind {
    let list = author_threads::of(&[thread("t", &[(false, body)])], ME, &none(), &none());
    list.threads[0].kind
}

#[test]
fn f26_1_a_question_mark_ending_a_sentence_makes_a_question() {
    for body in [
        "What happens if the app is killed in the middle of retrying? Do we lose the attempt count?",
        "Why this? Please explain.",
        "Should this be awaited?\n",
        "The delay grows linearly. Can we make it exponential with a cap?\nUse 2^n.",
    ] {
        assert_eq!(kind_of_first(body), ThreadKind::Question, "{body}");
    }
    let q = thread("t", &[(false, "Do we lose the attempt count?")]);
    assert_eq!(status(&[q]), ThreadStatus::Question);
}

#[test]
fn f26_1_any_other_unresolved_thread_is_a_change_requested() {
    for body in [
        "Rename this to `RetryDelay`.",
        "Make the delay exponential with a cap.",
        "See https://wiki.example/retry?page=2 for the rule",
        "```suggestion:-0+0\nawait Task.Delay(delay, ct);\n```",
        "Use `ok ? a : b` here.",
        "```suggestion:-0+0\nvar d = capped ? max : delay;\n```",
    ] {
        assert_eq!(kind_of_first(body), ThreadKind::Change, "{body}");
    }
    let change = thread("t", &[(false, "Rename this to `RetryDelay`.")]);
    assert_eq!(status(&[change]), ThreadStatus::ChangeRequested);
    let suggestion = thread("t", &[(false, "```suggestion:-0+0\nx\n```")]);
    assert_eq!(status(&[suggestion]), ThreadStatus::ChangeRequested);
}

#[test]
fn f26_1_the_kind_comes_from_the_first_note_only() {
    let change_then_question = thread("t", &[(false, "Make it exponential."), (false, "Why not?")]);
    assert_eq!(
        status(&[change_then_question]),
        ThreadStatus::ChangeRequested
    );
    let question_then_statement = thread("t", &[(false, "Is it needed?"), (false, "Ok, thanks.")]);
    assert_eq!(status(&[question_then_statement]), ThreadStatus::Question);
}

#[test]
fn f26_1_an_open_proposal_makes_fix_proposed() {
    let t = thread("t1", &[(false, "Make it exponential.")]);
    assert_eq!(
        status_of(&[t], &ids(&["t1"]), &none()),
        ThreadStatus::FixProposed
    );
}

#[test]
fn f26_1_a_proposal_or_queued_reply_of_another_thread_changes_nothing() {
    let t = thread("t1", &[(false, "Make it exponential.")]);
    assert_eq!(
        status_of(&[t], &ids(&["t2"]), &ids(&["t3"])),
        ThreadStatus::ChangeRequested
    );
}

#[test]
fn f26_1_a_queued_reply_makes_fixed_locally_and_wins_over_a_proposal() {
    let t = thread("t1", &[(false, "Make it exponential.")]);
    assert_eq!(
        status_of(std::slice::from_ref(&t), &none(), &ids(&["t1"])),
        ThreadStatus::FixedLocally
    );
    assert_eq!(
        status_of(&[t], &ids(&["t1"]), &ids(&["t1"])),
        ThreadStatus::FixedLocally
    );
}

#[test]
fn f26_1_my_reply_on_a_change_thread_makes_replied() {
    let t = thread(
        "t",
        &[(false, "Make it exponential."), (true, "Fixed in 9e1d4b7.")],
    );
    assert_eq!(status(&[t]), ThreadStatus::Replied);
}

#[test]
fn f26_1_my_reply_on_a_question_makes_answered() {
    let t = thread(
        "t",
        &[
            (false, "Do we lose the count?"),
            (true, "No, it stays in the queue."),
        ],
    );
    assert_eq!(status(&[t]), ThreadStatus::Answered);
}

#[test]
fn f26_1_a_reviewer_note_after_my_reply_opens_the_thread_again() {
    let change = thread(
        "t",
        &[
            (false, "Make it exponential."),
            (true, "Done."),
            (false, "Not capped yet."),
        ],
    );
    assert_eq!(status(&[change]), ThreadStatus::ChangeRequested);
    let question = thread(
        "t",
        &[(false, "Why?"), (true, "Because."), (false, "And when?")],
    );
    assert_eq!(status(&[question]), ThreadStatus::Question);
}

#[test]
fn f26_1_threads_to_answer_counts_unresolved_threads_whose_last_note_is_not_mine() {
    let threads = vec![
        thread("change", &[(false, "Make it exponential.")]),
        thread("question", &[(false, "Do we lose the count?")]),
        thread("proposed", &[(false, "Rename this.")]),
        thread(
            "replied",
            &[(false, "Make it exponential."), (true, "Done.")],
        ),
        thread("answered", &[(false, "Why?"), (true, "Because.")]),
        resolved("resolved", "Typo in a log message"),
    ];
    let list = author_threads::of(&threads, ME, &ids(&["proposed"]), &none());
    assert_eq!(list.to_answer, 3);
    assert_eq!(
        list.threads.len(),
        5,
        "answered and replied threads stay in the list"
    );
}

#[test]
fn f26_1_nothing_to_answer_is_zero() {
    let t = thread("t", &[(false, "Why?"), (true, "Because.")]);
    assert_eq!(author_threads::of(&[t], ME, &none(), &none()).to_answer, 0);
    assert_eq!(author_threads::of(&[], ME, &none(), &none()).to_answer, 0);
}

#[test]
fn f26_1_resolved_threads_fold_into_a_summary_with_the_first_excerpt() {
    let threads = vec![
        thread("open", &[(false, "Make it exponential.")]),
        resolved("r1", "Typo in a log message"),
        resolved("r2", "Missing newline at the end"),
    ];
    let list = author_threads::of(&threads, ME, &none(), &none());
    assert_eq!(list.resolved.count, 2);
    assert_eq!(
        list.resolved.first_excerpt.as_deref(),
        Some("Typo in a log message")
    );
    assert_eq!(list.threads.len(), 1);
    assert_eq!(list.threads[0].id, "open");
    assert_eq!(list.to_answer, 1, "a resolved thread is never to answer");
}

#[test]
fn f26_1_without_resolved_threads_the_summary_is_empty() {
    let list = author_threads::of(&[thread("t", &[(false, "Rename.")])], ME, &none(), &none());
    assert_eq!(list.resolved.count, 0);
    assert_eq!(list.resolved.first_excerpt, None);
}

#[test]
fn f26_1_a_comment_that_cannot_be_resolved_is_not_a_thread() {
    let comment = Thread {
        resolvable: false,
        position: None,
        ..thread("c", &[(false, "Nice work!")])
    };
    let list = author_threads::of(&[comment], ME, &none(), &none());
    assert!(list.threads.is_empty());
    assert_eq!(list.to_answer, 0);
    assert_eq!(list.resolved.count, 0);
}

#[test]
fn f26_1_the_list_keeps_the_order_of_the_discussions() {
    let threads = vec![
        thread("b", &[(false, "Second?")]),
        thread("a", &[(false, "First.")]),
        thread("c", &[(false, "Third.")]),
    ];
    let list = author_threads::of(&threads, ME, &none(), &none());
    let order: Vec<&str> = list.threads.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(order, ["b", "a", "c"]);
}

#[test]
fn f26_1_the_author_is_the_name_of_the_first_note_and_the_avatar_its_initials() {
    let t = thread("t", &[(false, "Rename."), (true, "Done.")]);
    let list = author_threads::of(&[t], ME, &none(), &none());
    assert_eq!(list.threads[0].author, "Marta K.");
    assert_eq!(list.threads[0].avatar, "MK");
}

#[test]
fn f26_1_initials_keep_polish_letters_and_a_single_name_gives_one() {
    let with = |name: &str| {
        let mut t = thread("t", &[(false, "Rename.")]);
        t.notes[0].author = user("x", name);
        author_threads::of(&[t], ME, &none(), &none())
            .threads
            .remove(0)
            .avatar
    };
    assert_eq!(with("Żaneta Łukasik"), "ŻŁ");
    assert_eq!(with("Piotr S."), "PS");
    assert_eq!(with("Piotr"), "P");
}

#[test]
fn f26_1_the_place_is_the_file_name_and_line_or_general() {
    let at = |position: Option<ThreadPosition>, outdated: bool, placed: Option<u32>| {
        let mut t = thread("t", &[(false, "Rename.")]);
        t.position = position;
        t.outdated = outdated;
        t.placed_line = placed;
        author_threads::of(&[t], ME, &none(), &none())
            .threads
            .remove(0)
            .place
    };
    assert_eq!(
        at(Some(position(Some(46), None)), false, None),
        "Upload Worker.cs:46"
    );
    assert_eq!(
        at(Some(position(None, Some(36))), false, None),
        "Upload Worker.cs:36"
    );
    assert_eq!(
        at(Some(position(None, None)), false, None),
        "Upload Worker.cs"
    );
    assert_eq!(
        at(Some(position(Some(46), None)), true, Some(52)),
        "Upload Worker.cs:52"
    );
    assert_eq!(at(None, false, None), "General");
}

#[test]
fn f26_1_the_excerpt_is_the_first_note_on_one_line() {
    let body = "  The delay grows\nlinearly.\n\n  Can we cap it?  ";
    let t = thread("t", &[(false, body), (true, "Done.")]);
    let list = author_threads::of(&[t], ME, &none(), &none());
    assert_eq!(
        list.threads[0].excerpt,
        "The delay grows linearly. Can we cap it?"
    );
}

#[test]
fn f26_1_a_long_excerpt_is_cut_with_an_ellipsis() {
    let body = "word ".repeat(200);
    let list = author_threads::of(&[thread("t", &[(false, &body)])], ME, &none(), &none());
    let excerpt = &list.threads[0].excerpt;
    assert!(
        excerpt.chars().count() <= 200,
        "{}",
        excerpt.chars().count()
    );
    assert!(excerpt.ends_with('…'));
    assert!(excerpt.starts_with("word word"));
}

#[test]
fn f26_1_the_result_reaches_the_screen_in_camel_case() {
    let threads = vec![
        thread("t1", &[(false, "Rename.")]),
        resolved("r1", "Typo in a log message"),
    ];
    let list = author_threads::of(&threads, ME, &none(), &ids(&["t1"]));
    let value = serde_json::to_value(list).unwrap();
    assert_eq!(value["toAnswer"], json!(1));
    assert_eq!(
        value["resolved"],
        json!({ "count": 1, "firstExcerpt": "Typo in a log message" })
    );
    let first = &value["threads"][0];
    assert_eq!(first["id"], json!("t1"));
    assert_eq!(first["status"], json!("fixedLocally"));
    assert_eq!(first["kind"], json!("change"));
    assert_eq!(first["place"], json!("Upload Worker.cs:46"));
    assert_eq!(first["avatar"], json!("MK"));
    assert_eq!(first["author"], json!("Marta K."));
}
