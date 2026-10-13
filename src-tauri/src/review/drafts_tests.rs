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
