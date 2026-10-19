#![allow(clippy::unwrap_used, reason = "tests")]
use super::*;
use crate::git::model::{FileStatus, Line};
use crate::gitlab::account::GitlabUser;
use crate::gitlab::discussions::{ThreadNote, ThreadPosition};
use crate::review::layer::layer_of;
use crate::review::mechanical::MechanicalReason;
use crate::review::plan_model::{Coverage, Orders};
use crate::review::{plan_fallback, step_order};

fn line(kind: LineKind) -> Line {
    Line {
        kind,
        old_no: None,
        new_no: None,
        text: String::new(),
        emphasis: Vec::new(),
        staged: None,
    }
}

/// A hunk at new lines `new_start..new_start + 3` (old the same), two added and one deleted line.
fn hunk(id: &str, new_start: u32) -> Hunk {
    Hunk {
        id: id.into(),
        old_start: new_start,
        old_lines: 3,
        new_start,
        new_lines: 3,
        header: String::new(),
        lines: vec![
            line(LineKind::Add),
            line(LineKind::Add),
            line(LineKind::Del),
        ],
        file_level: false,
        staged_differs: false,
        mechanical: None,
    }
}

fn file(path: &str, hunks: Vec<Hunk>) -> FileDiff {
    FileDiff {
        old_path: Some(path.into()),
        new_path: Some(path.into()),
        status: FileStatus::Modified,
        binary: false,
        mode_change: None,
        additions: 40,
        deletions: 7,
        layer: layer_of(path),
        hunks,
        line_staging: true,
    }
}

const VM: &str = "src/App/ViewModels/Upload ViewModel.cs";
const QUEUE: &str = "src/Mobile.Core/Upload/Zażółć Queue.cs";
const IFACE: &str = "src/Mobile.Core/IUploadQueue.cs";

/// VM has two hunks split across s1 (a1) and s2 (a2); s2 also holds QUEUE and IFACE.
fn files() -> Vec<FileDiff> {
    let mut generated = hunk("q2", 50);
    generated.mechanical = Some(MechanicalReason::Whitespace);
    vec![
        file(VM, vec![hunk("a1", 10), hunk("a2", 100)]),
        file(QUEUE, vec![hunk("q1", 1), generated]),
        file(IFACE, vec![hunk("i1", 1)]),
    ]
}

fn step(id: &str, hunks: &[&str]) -> Step {
    Step {
        id: id.into(),
        title: format!("Title {id}"),
        short_title: id.into(),
        reason: String::new(),
        description: format!("Description {id}"),
        layer: layer_of(VM),
        hunk_ids: hunks.iter().map(|&h| h.into()).collect(),
        builds_on: Vec::new(),
    }
}

fn plan() -> Plan {
    Plan {
        intent: String::new(),
        steps: vec![
            step("s1", &["a1"]),
            step("s2", &["a2", "q1", "q2", "i1"]),
            step("s3", &[]),
        ],
        orders: Orders {
            contract_to_ui: Vec::new(),
            tests_first: Vec::new(),
        },
        skim: Vec::new(),
        risks: Vec::new(),
        description_check: Vec::new(),
        already_discussed: String::new(),
        coverage: Coverage::default(),
    }
}

fn order() -> Vec<String> {
    vec!["s2".into(), "s1".into(), "s3".into()]
}

fn thread(id: &str, path: &str, new_line: Option<u32>, old_line: Option<u32>) -> Thread {
    Thread {
        id: id.into(),
        resolvable: true,
        resolved: false,
        position: Some(ThreadPosition {
            old_path: path.into(),
            new_path: path.into(),
            old_line,
            new_line,
            head_sha: "h".into(),
            base_sha: "b".into(),
        }),
        notes: vec![ThreadNote {
            id: 1,
            author: GitlabUser {
                username: "pawel.s".into(),
                name: "Paweł S.".into(),
            },
            body: "Why not a channel?".into(),
            created_at: "2026-10-12T09:00:00Z".into(),
        }],
        outdated: false,
        placed_line: None,
    }
}

fn ids<T>(items: &[T], id: impl Fn(&T) -> &str) -> Vec<&str> {
    items.iter().map(id).collect()
}

#[test]
fn f07_2_number_total_prev_next_in_reader_order() {
    let view = build(&plan(), &files(), &[], &order(), "s1", false).unwrap();
    assert_eq!((view.number, view.total), (2, 3));
    assert_eq!(view.prev.as_deref(), Some("s2"));
    assert_eq!(view.next.as_deref(), Some("s3"));
    assert_eq!(view.step.title, "Title s1");
    assert_eq!(view.step.description, "Description s1");
    assert!(!view.fallback);

    let first = build(&plan(), &files(), &[], &order(), "s2", true).unwrap();
    assert_eq!((first.number, first.prev, first.reviewed), (1, None, true));
    let last = build(&plan(), &files(), &[], &order(), "s3", false).unwrap();
    assert_eq!((last.number, last.next), (3, None));
    assert!(last.files.is_empty());
}

#[test]
fn f07_2_unknown_step_rejected() {
    let missing = build(&plan(), &files(), &[], &order(), "s9", false);
    assert_eq!(missing, Err(StepViewError::NotInPlan));
    // In the plan but not in the order (an older dragged order) is rejected too.
    let not_ordered = build(&plan(), &files(), &[], &["s1".into()], "s2", false);
    assert_eq!(not_ordered, Err(StepViewError::NotInPlan));
    let error = AppError::from(StepViewError::NotInPlan);
    assert_eq!(error.message, "The step is not in the plan.");
}

#[test]
fn f07_2_fallback_plan_uses_file_order() {
    let files = files();
    let plan = plan_fallback::plan(&files, &[]);
    let order = step_order::fallback(&plan).order;
    let view = build(&plan, &files, &[], &order, &order[0], false).unwrap();
    assert_eq!(
        (view.number, view.total),
        (1, u32::try_from(order.len()).unwrap())
    );
    assert!(!view.files.is_empty());
}

#[test]
fn f07_3_files_only_step_hunks_with_recounted_stats() {
    let view = build(&plan(), &files(), &[], &order(), "s2", false).unwrap();
    // GitLab file order: directories first, then byte-wise.
    assert_eq!(
        ids(&view.files, |f| f.new_path.as_deref().unwrap()),
        [VM, QUEUE, IFACE]
    );
    let vm = &view.files[0];
    assert_eq!(ids(&vm.hunks, |h| &h.id), ["a2"]);
    assert_eq!((vm.additions, vm.deletions), (2, 1));
    // A file whose every hunk is in the step keeps its own counts.
    let queue = &view.files[1];
    assert_eq!(ids(&queue.hunks, |h| &h.id), ["q1", "q2"]);
    assert_eq!((queue.additions, queue.deletions), (40, 7));
}

#[test]
fn f07_3_mechanical_hunks_kept_flagged() {
    let view = build(&plan(), &files(), &[], &order(), "s2", false).unwrap();
    let q2 = &view.files[1].hunks[1];
    assert_eq!(q2.mechanical, Some(MechanicalReason::Whitespace));
}

#[test]
fn f07_5_threads_inside_the_step_hunks_only() {
    let threads = vec![
        thread("in-a1", VM, Some(11), None),
        thread("in-a2", VM, Some(102), None),
        thread("past-a2", VM, Some(103), None),
        thread("removed-line", QUEUE, None, Some(2)),
        thread("other-file", "src/Other.cs", Some(1), None),
        Thread {
            position: None,
            ..thread("mr-comment", VM, None, None)
        },
    ];
    let s2 = build(&plan(), &files(), &threads, &order(), "s2", false).unwrap();
    assert_eq!(ids(&s2.threads, |t| &t.id), ["in-a2", "removed-line"]);
    let s1 = build(&plan(), &files(), &threads, &order(), "s1", false).unwrap();
    assert_eq!(ids(&s1.threads, |t| &t.id), ["in-a1"]);
}

#[test]
fn f11_3_a_thread_no_step_shows_on_a_line_is_on_the_file_header_of_the_first_step_in_order() {
    let threads = vec![
        thread("in-a1", VM, Some(11), None),
        thread("past-a2", VM, Some(103), None),
        thread("other-file", "src/Other.cs", Some(1), None),
        Thread {
            outdated: true,
            ..thread("no-match", VM, Some(11), None)
        },
        Thread {
            outdated: true,
            placed_line: Some(102),
            ..thread("placed", VM, Some(11), None)
        },
    ];
    // The order is s2, s1, s3: s2 is the first step with the ViewModel.
    let s2 = build(&plan(), &files(), &threads, &order(), "s2", false).unwrap();
    assert_eq!(ids(&s2.threads, |t| &t.id), ["placed"]);
    assert_eq!(ids(&s2.file_threads, |t| &t.id), ["past-a2", "no-match"]);
    let s1 = build(&plan(), &files(), &threads, &order(), "s1", false).unwrap();
    assert_eq!(ids(&s1.threads, |t| &t.id), ["in-a1"]);
    assert!(s1.file_threads.is_empty());
}
