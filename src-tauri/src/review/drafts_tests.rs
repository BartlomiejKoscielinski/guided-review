use super::*;
use crate::review::finding_model::Side;
use crate::store::Store;

fn new(session: &str, body: &str, position: Option<DiffPosition>) -> NewDraft {
    NewDraft {
        session_id: session.into(),
        finding_id: None,
        body: body.into(),
        position,
        severity: None,
    }
}

fn on_line(line: u32) -> Option<DiffPosition> {
    Some(DiffPosition {
        file: "src/App/Zażółć/Upload ViewModel.cs".into(),
        side: Side::New,
        line,
    })
}

fn with<T>(f: impl FnOnce(&Connection) -> Result<T, DraftError>) -> T {
    let store = Store::open_in_memory().unwrap();
    let mut out = None;
    store
        .with_conn(|c| {
            out = Some(f(c));
            Ok(())
        })
        .unwrap();
    out.unwrap().unwrap()
}

#[test]
fn f09_2_drafts_are_created_listed_in_order_updated_and_deleted() {
    with(|c| {
        let first = create(
            c,
            &NewDraft {
                finding_id: Some("f1".into()),
                severity: Some(Severity::Q),
                ..new("r1", "Should `Enqueue` be awaited?", on_line(2))
            },
        )?;
        let second = create(c, &new("r1", "Looks good overall.", None))?;
        create(c, &new("r2", "Other review.", None))?;
        assert!(first.include);
        assert_eq!(first.published_note_id, None);
        assert_eq!(first.position, on_line(2));
        assert_eq!(first.severity, Some(Severity::Q));
        assert_eq!(first.finding_id.as_deref(), Some("f1"));
        assert_eq!(list(c, "r1")?, [first.clone(), second.clone()]);

        let edited = update(
            c,
            &first.id,
            &DraftPatch {
                body: Some("Is `Enqueue` awaited?".into()),
                include: Some(false),
            },
        )?;
        assert_eq!(edited.body, "Is `Enqueue` awaited?");
        assert!(!edited.include);
        assert_eq!(edited.position, first.position, "the position stays");
        let kept = update(c, &first.id, &DraftPatch::default())?;
        assert_eq!(kept, edited);

        delete(c, &second.id)?;
        assert_eq!(list(c, "r1")?, [edited]);
        assert!(matches!(get(c, &second.id), Err(DraftError::NotFound(_))));
        Ok(())
    });
}

#[test]
fn f09_2_empty_text_is_rejected() {
    with(|c| {
        assert!(matches!(
            create(c, &new("r1", "  \n", None)),
            Err(DraftError::EmptyBody)
        ));
        let draft = create(c, &new("r1", "Text.", None))?;
        let patch = DraftPatch {
            body: Some(" ".into()),
            include: None,
        };
        assert!(matches!(
            update(c, &draft.id, &patch),
            Err(DraftError::EmptyBody)
        ));
        Ok(())
    });
}

#[test]
fn f09_2_published_drafts_cannot_be_changed_locally() {
    with(|c| {
        let draft = create(c, &new("r1", "Text.", on_line(3)))?;
        c.execute(
            "UPDATE drafts SET published_note_id = 77 WHERE id = ?1",
            [&draft.id],
        )?;
        assert_eq!(get(c, &draft.id)?.published_note_id, Some(77));
        assert!(matches!(
            update(c, &draft.id, &DraftPatch::default()),
            Err(DraftError::Published(_))
        ));
        assert!(matches!(
            delete(c, &draft.id),
            Err(DraftError::Published(_))
        ));
        let error = AppError::from(DraftError::Published(draft.id));
        assert_eq!(error.code, ErrorCode::Conflict);
        Ok(())
    });
}

// F-08.3: a draft on a line without a note (the line comment composer, F-09.7) belongs to the
// plan step holding the hunk of that line: `step_at` finds it from the diff and the plan.
mod f08_3 {
    use super::*;
    use crate::git::model::{FileDiff, FileStatus, Hunk, Line, LineKind};
    use crate::review::layer::Layer;
    use crate::review::plan_model::{Coverage, Orders, Plan, SkimGroup, Step};

    const QUEUE: &str = "src/Mobile.Core/Uploads/IUploadQueue.cs";
    const VM: &str = "src/App/Zażółć/Upload ViewModel.cs";
    const CSPROJ: &str = "src/App/App.csproj";

    fn line(kind: LineKind, old_no: Option<u32>, new_no: Option<u32>) -> Line {
        Line {
            kind,
            old_no,
            new_no,
            text: String::new(),
            emphasis: Vec::new(),
            staged: None,
        }
    }

    fn hunk(id: &str, (old_start, new_start): (u32, u32), lines: Vec<Line>) -> Hunk {
        let count = |pick: fn(&Line) -> Option<u32>| {
            u32::try_from(lines.iter().filter(|l| pick(l).is_some()).count()).unwrap()
        };
        Hunk {
            id: id.into(),
            old_start,
            old_lines: count(|l| l.old_no),
            new_start,
            new_lines: count(|l| l.new_no),
            header: String::new(),
            lines,
            file_level: false,
            staged_differs: false,
            mechanical: None,
        }
    }

    fn file(path: &str, status: FileStatus, hunks: Vec<Hunk>) -> FileDiff {
        FileDiff {
            old_path: Some(path.into()),
            new_path: Some(path.into()),
            status,
            binary: false,
            mode_change: None,
            additions: 0,
            deletions: 0,
            layer: Layer::App,
            hunks,
            line_staging: true,
        }
    }

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

    fn change() -> (Plan, Vec<FileDiff>) {
        let files = vec![
            file(
                QUEUE,
                FileStatus::Added,
                vec![hunk(
                    "h1",
                    (0, 1),
                    (1..=3)
                        .map(|n| line(LineKind::Add, None, Some(n)))
                        .collect(),
                )],
            ),
            file(
                VM,
                FileStatus::Modified,
                vec![
                    hunk(
                        "h2",
                        (10, 10),
                        vec![
                            line(LineKind::Ctx, Some(10), Some(10)),
                            line(LineKind::Del, Some(11), None),
                            line(LineKind::Add, None, Some(11)),
                            line(LineKind::Add, None, Some(12)),
                        ],
                    ),
                    hunk(
                        "h3",
                        (38, 40),
                        vec![
                            line(LineKind::Ctx, Some(38), Some(40)),
                            line(LineKind::Add, None, Some(41)),
                        ],
                    ),
                ],
            ),
            file(
                CSPROJ,
                FileStatus::Modified,
                vec![hunk("h4", (5, 5), vec![line(LineKind::Add, None, Some(5))])],
            ),
        ];
        let plan = Plan {
            intent: String::new(),
            steps: vec![
                step("s1", &["h1"]),
                step("s4", &["h2"]),
                step("s5", &["h3"]),
            ],
            orders: Orders::default(),
            skim: vec![SkimGroup {
                hunk_ids: vec!["h4".into()],
                reason: "csproj: a new package.".into(),
            }],
            risks: Vec::new(),
            description_check: Vec::new(),
            already_discussed: String::new(),
            coverage: Coverage::default(),
        };
        (plan, files)
    }

    fn at(file: &str, side: Side, line: u32) -> DiffPosition {
        DiffPosition {
            file: file.into(),
            side,
            line,
        }
    }

    #[test]
    fn f08_3_a_draft_on_a_line_belongs_to_the_step_holding_its_hunk() {
        let (plan, files) = change();
        let step_of = |position: DiffPosition| step_at(&plan, &files, &position);
        assert_eq!(step_of(at(QUEUE, Side::New, 2)).as_deref(), Some("s1"));
        assert_eq!(step_of(at(VM, Side::New, 12)).as_deref(), Some("s4"));
        // A deleted line is numbered on the old side.
        assert_eq!(step_of(at(VM, Side::Old, 11)).as_deref(), Some("s4"));
        assert_eq!(step_of(at(VM, Side::New, 41)).as_deref(), Some("s5"));
    }

    #[test]
    fn f08_3_a_line_in_no_step_gives_no_step() {
        let (plan, files) = change();
        let step_of = |position: DiffPosition| step_at(&plan, &files, &position);
        // Between two hunks, in a skim group, in a file outside the change.
        assert_eq!(step_of(at(VM, Side::New, 30)), None);
        assert_eq!(step_of(at(CSPROJ, Side::New, 5)), None);
        assert_eq!(step_of(at("src/Other.cs", Side::New, 1)), None);
    }
}
