use super::*;
use crate::review::plan_model::{Claim, ClaimStatus, Orders, Risk, RiskSeverity, SkimGroup};

fn step(id: &str, hunk_ids: &[&str]) -> Step {
    Step {
        id: id.into(),
        title: id.into(),
        short_title: id.into(),
        reason: String::new(),
        description: String::new(),
        layer: Layer::App,
        hunk_ids: hunk_ids.iter().map(|&h| h.into()).collect(),
        builds_on: Vec::new(),
    }
}

fn skim(hunk_ids: &[&str]) -> SkimGroup {
    SkimGroup {
        hunk_ids: hunk_ids.iter().map(|&h| h.into()).collect(),
        reason: "Formatting only, no logic changes.".into(),
    }
}

fn plan(steps: Vec<Step>, skim: Vec<SkimGroup>) -> Plan {
    Plan {
        intent: String::new(),
        steps,
        orders: Orders::default(),
        skim,
        risks: Vec::new(),
        description_check: Vec::new(),
        already_discussed: String::new(),
        coverage: Coverage::default(),
    }
}

const HUNKS: [HunkRef; 5] = [
    HunkRef {
        id: "h1",
        file: "src/Mobile.Core/Upload/UploadQueue.cs",
    },
    HunkRef {
        id: "h2",
        file: "src/Mobile.Core/Upload/UploadQueue.cs",
    },
    HunkRef {
        id: "h3",
        file: "src/App/ViewModels/QueueViewModel.cs",
    },
    HunkRef {
        id: "h4",
        file: "src/App/Views/Ąę Strona.xaml",
    },
    HunkRef {
        id: "h5",
        file: "src/App/App.csproj",
    },
];

fn hunk_ids(step: &Step) -> Vec<&str> {
    step.hunk_ids.iter().map(String::as_str).collect()
}

#[test]
fn f06_10_complete_plan_is_unchanged_and_fully_covered() {
    let mut p = plan(
        vec![step("s1", &["h1", "h2"]), step("s2", &["h3", "h4"])],
        vec![skim(&["h5"])],
    );
    let before = p.steps.clone();
    enforce(&mut p, &HUNKS);
    assert_eq!(p.steps, before);
    assert!(holds(&p, &HUNKS));
    let full = Coverage {
        files: 4,
        files_total: 4,
        hunks: 5,
        hunks_total: 5,
    };
    assert_eq!(p.coverage, full);
}

#[test]
fn f06_10_missing_hunks_go_to_an_other_step_at_the_end() {
    let mut p = plan(vec![step("s1", &["h1"]), step("s3", &["h3"])], vec![]);
    enforce(&mut p, &HUNKS);
    let other = p.steps.last().unwrap();
    assert_eq!(other.id, "s4");
    assert_eq!(other.title, "Other");
    assert_eq!(other.layer, Layer::Other);
    assert_eq!(hunk_ids(other), ["h2", "h4", "h5"]);
    assert!(holds(&p, &HUNKS));
    assert_eq!(p.orders.contract_to_ui, ["s1", "s3", "s4"]);
}

#[test]
fn f06_10_unknown_ids_are_dropped_and_duplicates_keep_the_first_place() {
    let mut p = plan(
        vec![
            step("s1", &["h1", "zz", "h2"]),
            step("s2", &["h2", "h3", "h4"]),
        ],
        vec![skim(&["h3", "h5", "nope"])],
    );
    enforce(&mut p, &HUNKS);
    assert_eq!(hunk_ids(&p.steps[0]), ["h1", "h2"]);
    assert_eq!(hunk_ids(&p.steps[1]), ["h3", "h4"]);
    assert_eq!(p.skim[0].hunk_ids, ["h5"]);
    assert_eq!(p.steps.len(), 2);
    assert!(holds(&p, &HUNKS));
}

#[test]
fn f06_10_emptied_steps_disappear_with_their_references() {
    let mut p = plan(
        vec![
            step("s1", &["h1", "h2", "h3"]),
            step("s2", &["h1", "x"]),
            step("s3", &["h4"]),
        ],
        vec![skim(&["h2"]), skim(&["h5"])],
    );
    p.steps[2].builds_on = vec!["s2".into(), "s1".into()];
    p.orders.contract_to_ui = vec!["s2".into(), "s3".into(), "s1".into()];
    p.risks.push(Risk {
        text: "Retry can run twice.".into(),
        severity: RiskSeverity::Fix,
        steps: vec!["s2".into(), "s3".into()],
        app: false,
    });
    p.description_check.push(Claim {
        claim: "Adds a queue.".into(),
        status: ClaimStatus::Found,
        step: Some("s2".into()),
    });
    enforce(&mut p, &HUNKS);
    let ids: Vec<&str> = p.steps.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, ["s1", "s3"]);
    assert_eq!(p.skim.len(), 1);
    assert_eq!(p.steps[1].builds_on, ["s1"]);
    assert_eq!(p.orders.contract_to_ui, ["s3", "s1"]);
    assert_eq!(p.orders.tests_first, ["s1", "s3"]);
    assert_eq!(p.risks[0].steps, ["s3"]);
    assert_eq!(p.description_check[0].step, None);
}

#[test]
fn f06_10_enforce_is_idempotent() {
    let mut p = plan(vec![step("s2", &["h3"])], vec![]);
    enforce(&mut p, &HUNKS);
    let once = p.clone();
    enforce(&mut p, &HUNKS);
    assert_eq!(p, once);
}

#[test]
fn f06_10_coverage_counts_files_only_when_all_their_hunks_are_placed() {
    let p = plan(vec![step("s1", &["h1", "h3"])], vec![skim(&["h5"])]);
    let c = coverage(&p, &HUNKS);
    assert_eq!(
        c,
        Coverage {
            files: 2,
            files_total: 4,
            hunks: 3,
            hunks_total: 5
        }
    );
    assert!(!holds(&p, &HUNKS));
}

/// xorshift64*: deterministic randomness without a new dependency.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: usize) -> usize {
        usize::try_from(self.next() % n as u64).unwrap()
    }
}

#[test]
fn f06_10_random_plans_never_drop_or_duplicate_a_hunk() {
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    for round in 0..500 {
        let total = 1 + rng.below(40);
        let ids: Vec<String> = (0..total).map(|i| format!("{i:016x}")).collect();
        let files: Vec<String> = (0..total).map(|i| format!("src/F{}.cs", i % 7)).collect();
        let hunks: Vec<HunkRef> = ids
            .iter()
            .zip(&files)
            .map(|(id, file)| HunkRef { id, file })
            .collect();
        let pick = |rng: &mut Rng| -> Vec<String> {
            (0..rng.below(8))
                .map(|_| match rng.below(10) {
                    0 => format!("unknown-{}", rng.below(5)),
                    _ => ids[rng.below(total)].clone(),
                })
                .collect()
        };
        let steps: Vec<Step> = (0..rng.below(10))
            .map(|i| Step {
                hunk_ids: pick(&mut rng),
                ..step(&format!("s{}", i + 1), &[])
            })
            .collect();
        let groups: Vec<SkimGroup> = (0..rng.below(3))
            .map(|_| SkimGroup {
                hunk_ids: pick(&mut rng),
                reason: String::new(),
            })
            .collect();
        let mut p = plan(steps, groups);
        enforce(&mut p, &hunks);
        assert!(holds(&p, &hunks), "round {round}");
        assert!(
            p.steps.iter().all(|s| !s.hunk_ids.is_empty()),
            "round {round}"
        );
        assert_eq!(p.coverage.hunks, p.coverage.hunks_total, "round {round}");
        assert_eq!(p.coverage.files, p.coverage.files_total, "round {round}");
        let step_ids: HashSet<&str> = p.steps.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(
            step_ids.len(),
            p.steps.len(),
            "round {round}: unique step IDs"
        );
        assert_eq!(
            p.orders.contract_to_ui.len(),
            p.steps.len(),
            "round {round}"
        );
    }
}

#[test]
fn f06_10_hunk_refs_list_every_hunk_with_its_path() {
    use crate::git::model::{FileStatus, Hunk};
    let h = |id: &str| Hunk {
        id: id.into(),
        old_start: 0,
        old_lines: 0,
        new_start: 0,
        new_lines: 0,
        header: String::new(),
        lines: Vec::new(),
        file_level: true,
        staged_differs: false,
        mechanical: None,
    };
    let file = |old: Option<&str>, new: Option<&str>, status, hunks| FileDiff {
        old_path: old.map(Into::into),
        new_path: new.map(Into::into),
        status,
        binary: false,
        mode_change: None,
        additions: 0,
        deletions: 0,
        layer: Layer::Other,
        hunks,
        line_staging: true,
    };
    let files = [
        file(
            Some("a.cs"),
            Some("b.cs"),
            FileStatus::Renamed,
            vec![h("r")],
        ),
        file(Some("gone.cs"), None, FileStatus::Deleted, vec![h("d")]),
    ];
    assert_eq!(
        hunk_refs(&files),
        [
            HunkRef {
                id: "r",
                file: "b.cs"
            },
            HunkRef {
                id: "d",
                file: "gone.cs"
            }
        ]
    );
}
