//! F-25.1 on S-10: Fix with Claude on a change thread of my own MR (docs/plans/M7.md, F-25.1).
//! What the run fixes (the thread's file, line and conversation) and the facts `fix_allowed`
//! reads around my MR: the active checkout is the MR's project, the MR author is me, and its
//! source branch is the branch checked out (F-26.8). Pure, so the command stays thin.

use crate::error::{AppError, AppResult, ErrorCode};
use crate::review::author_threads::{AuthorThread, ThreadKind};

use super::eligibility::FixContext;

/// The thread a fix starts from: its file, the line Claude looks at, and what was asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadNote {
    pub file: String,
    pub line: u32,
    pub request: String,
}

/// The note of `thread` for the fix task. A question is answered, not fixed (F-26.7), and a
/// General thread has no file: both `INVALID_INPUT`, so no screen can start such a run.
pub fn thread_note(thread: &AuthorThread) -> AppResult<ThreadNote> {
    if thread.kind != ThreadKind::Change {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            "Only a change request can be fixed.",
        ));
    }
    let file = thread
        .path
        .clone()
        .ok_or_else(|| AppError::new(ErrorCode::InvalidInput, "This thread has no file to fix."))?;
    let request = thread
        .notes
        .iter()
        .map(|n| {
            let who = if n.mine {
                "Me (the MR author)"
            } else {
                &n.author
            };
            format!("{who}: {}", n.body)
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    Ok(ThreadNote {
        file,
        line: thread.line.or(thread.old_line).unwrap_or(1),
        request,
    })
}

/// Whether the active repository is the checkout of `project`: a repository without a GitLab
/// origin is taken as the project's (as S-10's read-only check does), another project is not.
pub fn same_project(repo_project: Option<&str>, project: &str) -> bool {
    repo_project.is_none_or(|p| p.eq_ignore_ascii_case(project))
}

/// What the core knows around my MR when a thread's fix is asked for.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AuthorFacts {
    /// The active repository is the MR's project; `false` without an active repository.
    pub active_repository: bool,
    pub me: Option<String>,
    pub mr_author: Option<String>,
    pub mr_source_branch: String,
    pub checkout_branch: Option<String>,
}

/// The `FixContext` of a thread of my MR; empty usernames count as unknown.
pub fn author_context(facts: AuthorFacts) -> FixContext {
    let known = |s: Option<String>| s.filter(|s| !s.is_empty());
    FixContext {
        active_repository: facts.active_repository,
        me: known(facts.me),
        mr_author: known(facts.mr_author),
        mr_source_branch: Some(facts.mr_source_branch).filter(|b| !b.is_empty()),
        checkout_branch: known(facts.checkout_branch),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]

    use super::*;
    use crate::fix::eligibility::fix_allowed;
    use crate::review::author_threads::{AuthorNote, ThreadStatus};
    use crate::source::model::Source;

    fn note(author: &str, body: &str, mine: bool) -> AuthorNote {
        AuthorNote {
            author: author.into(),
            avatar: "MK".into(),
            body: body.into(),
            created_at: "2026-10-20T10:00:00Z".into(),
            mine,
        }
    }

    fn change() -> AuthorThread {
        AuthorThread {
            id: "d1".into(),
            author: "Marta K.".into(),
            avatar: "MK".into(),
            place: "Ładowanie zdjęć/UploadWorker.cs:46".into(),
            path: Some("src/Ładowanie zdjęć/UploadWorker.cs".into()),
            line: Some(46),
            old_line: None,
            excerpt: "The delay grows linearly.".into(),
            kind: ThreadKind::Change,
            status: ThreadStatus::ChangeRequested,
            notes: vec![
                note("Marta K.", "The delay grows linearly.", false),
                note("Bartek K.", "On it.", true),
            ],
        }
    }

    fn facts() -> AuthorFacts {
        AuthorFacts {
            active_repository: true,
            me: Some("bartek".into()),
            mr_author: Some("bartek".into()),
            mr_source_branch: "feature/upload-retry".into(),
            checkout_branch: Some("feature/upload-retry".into()),
        }
    }

    fn mr() -> Source {
        Source::Mr {
            project: "mobile/delivery-app".into(),
            iid: 480,
        }
    }

    fn refused(facts: AuthorFacts) -> bool {
        fix_allowed(&mr(), &author_context(facts))
            .is_err_and(|e| e.code == ErrorCode::FixNotAllowed)
    }

    #[test]
    fn f25_1_thread_of_my_mr_on_its_source_branch_is_allowed() {
        assert!(fix_allowed(&mr(), &author_context(facts())).is_ok());
    }

    #[test]
    fn f25_1_thread_of_a_teammates_mr_is_refused() {
        assert!(refused(AuthorFacts {
            mr_author: Some("marta".into()),
            ..facts()
        }));
    }

    #[test]
    fn f25_1_thread_off_the_source_branch_or_detached_is_refused() {
        assert!(refused(AuthorFacts {
            checkout_branch: Some("develop".into()),
            ..facts()
        }));
        assert!(refused(AuthorFacts {
            checkout_branch: None,
            ..facts()
        }));
    }

    #[test]
    fn f25_1_thread_in_another_repository_or_unknown_users_is_refused() {
        assert!(refused(AuthorFacts {
            active_repository: false,
            ..facts()
        }));
        // Empty usernames are unknown, never equal to each other.
        assert!(refused(AuthorFacts {
            me: Some(String::new()),
            mr_author: Some(String::new()),
            ..facts()
        }));
    }

    #[test]
    fn f25_1_same_project_matches_case_insensitively_and_without_origin() {
        assert!(same_project(
            Some("Mobile/Delivery-App"),
            "mobile/delivery-app"
        ));
        assert!(same_project(None, "mobile/delivery-app"));
        assert!(!same_project(Some("mobile/other"), "mobile/delivery-app"));
    }

    #[test]
    fn f25_1_change_thread_gives_its_file_line_and_conversation() {
        let n = thread_note(&change()).unwrap();
        assert_eq!(n.file, "src/Ładowanie zdjęć/UploadWorker.cs");
        assert_eq!(n.line, 46);
        assert_eq!(
            n.request,
            "Marta K.: The delay grows linearly.\n\nMe (the MR author): On it."
        );
    }

    #[test]
    fn f25_1_thread_on_a_removed_line_uses_the_old_line() {
        let thread = AuthorThread {
            line: None,
            old_line: Some(12),
            ..change()
        };
        assert_eq!(thread_note(&thread).unwrap().line, 12);
    }

    #[test]
    fn f25_1_question_and_general_threads_are_not_fixed() {
        let question = AuthorThread {
            kind: ThreadKind::Question,
            status: ThreadStatus::Question,
            ..change()
        };
        let general = AuthorThread {
            path: None,
            line: None,
            ..change()
        };
        for thread in [question, general] {
            let error = thread_note(&thread).unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidInput);
        }
    }
}
