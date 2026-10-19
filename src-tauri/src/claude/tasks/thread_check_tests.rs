#![allow(clippy::unwrap_used, reason = "tests")]

use serde_json::{Value, json};

use super::*;

const HEAD: &str = "c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2";
const T1: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const C1: &str = "b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1";
const C1_TWIN: &str = "b1b1b1b1ffffffffffffffffffffffffffffffff";

fn thread(id: &str, head: &str, resolved: bool, resolvable: bool) -> Thread {
    let mut note = json!({ "id": 2, "body": format!("Note of {id}"),
        "author": { "username": "alice", "name": "Alice" }, "created_at": "2026-10-12T10:00:00Z",
        "system": false, "resolvable": resolvable, "resolved": resolved });
    if !head.is_empty() {
        note["position"] = json!({ "old_path": "a.cs", "new_path": "a.cs", "new_line": 3,
            "head_sha": head, "base_sha": "abc" });
    }
    discussions::parse(vec![json!({ "id": id, "notes": [note] })])
        .unwrap()
        .remove(0)
}

fn answer(items: &[(&str, &str, &str)]) -> Value {
    let addressed: Vec<Value> = items
        .iter()
        .map(|(d, c, h)| json!({ "discussion_id": d, "commit": c, "hint": h }))
        .collect();
    json!({ "addressed": addressed })
}

#[test]
fn f13_3_a_candidate_is_open_and_written_on_another_commit() {
    assert!(is_candidate(&thread("d", T1, false, true), HEAD));
    // The reviewed head itself, in another case: current.
    assert!(!is_candidate(
        &thread("d", &HEAD.to_ascii_uppercase(), false, true),
        HEAD
    ));
    assert!(!is_candidate(&thread("d", T1, true, true), HEAD));
    assert!(!is_candidate(&thread("d", T1, false, false), HEAD));
    // A comment on the MR itself, and a head that is no commit id.
    assert!(!is_candidate(&thread("d", "", false, true), HEAD));
    assert!(!is_candidate(&thread("d", "main", false, true), HEAD));
}

#[test]
fn f13_3_the_threads_file_names_the_later_commits_but_not_the_threads_head() {
    let t = thread("disc-1", T1, false, true);
    let file = threads_file(&[Candidate {
        thread: &t,
        later: vec![C1.into(), HEAD.into()],
    }]);
    assert!(file.contains("Thread disc-1 · a.cs:3 (new)"), "{file}");
    assert!(
        file.contains(&format!("Later commits: {C1}, {HEAD}")),
        "{file}"
    );
    assert!(
        file.contains("alice (2026-10-12T10:00:00Z): Note of disc-1"),
        "{file}"
    );
    assert!(!file.contains(T1), "{file}");
}

#[test]
fn f13_3_the_commits_file_caps_each_commit_and_the_total_but_names_every_commit() {
    let big = "+x\n".repeat(COMMIT_MAX);
    let mut log = String::new();
    for index in 0..12 {
        log.push_str(&format!("\u{1e}{index:040}\nSubject {index}\n\n{big}"));
    }
    let file = render_log(&log);
    assert!(file.len() < LOG_MAX + 12 * 200, "{} bytes", file.len());
    for index in 0..12 {
        assert!(file.contains(&format!("Commit {index:040} · Subject {index}\n")));
    }
    assert!(file.contains("more bytes of this commit left out: size cap"));
    // A short commit stays whole.
    let small = render_log("\u{1e}abc\nFix it\n\nbody\ndiff --git a/x b/x\n");
    assert_eq!(small, "Commit abc · Fix it\nbody\ndiff --git a/x b/x\n\n");
}

#[test]
fn f13_3_the_cut_keeps_a_character_whole() {
    let text = "ąąą";
    assert_eq!(cut(text, 3), "ą");
    assert_eq!(cut(text, 100), text);
}

#[test]
fn f13_3_a_hint_names_a_later_commit_of_its_own_thread_by_full_id_or_unique_prefix() {
    let t = thread("disc-1", T1, false, true);
    let candidates = [Candidate {
        thread: &t,
        later: vec![C1.into(), HEAD.into()],
    }];
    let hints = hints_of(
        &answer(&[("disc-1", &HEAD[..9], " index added ")]),
        &candidates,
    )
    .unwrap();
    assert_eq!(
        hints,
        vec![ThreadHint {
            discussion_id: "disc-1".into(),
            commit: HEAD.into(),
            hint: "index added".into(),
        }]
    );
    // Too short, ambiguous, outside the range.
    let twins = [Candidate {
        thread: &t,
        later: vec![C1.into(), C1_TWIN.into()],
    }];
    for (commit, within) in [
        (&C1[..6], &candidates),
        (&C1[..8], &twins),
        (T1, &candidates),
    ] {
        let error = hints_of(&answer(&[("disc-1", commit, "x")]), within).unwrap_err();
        assert!(matches!(error, ClaudeError::Schema(_)), "{commit}");
    }
    // A long hint is clamped.
    let long = "word ".repeat(30);
    let hints = hints_of(&answer(&[("disc-1", C1, &long)]), &candidates).unwrap();
    assert_eq!(hints[0].hint.chars().count(), HINT_MAX);
    assert!(hints_of(&answer(&[]), &candidates).unwrap().is_empty());
}
