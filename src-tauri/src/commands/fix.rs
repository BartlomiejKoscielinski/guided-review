//! `fix_*` commands (F-25, docs/plans/M7.md): Fix with Claude on the user's own code. A run
//! makes a scratch worktree (ADR-018), lets Claude edit the one file there, checks that nothing
//! else changed and answers with the proposal (F-25.3); the scratch waits for Accept or Discard
//! (F-25.4). The user's checkout is only read.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::State;
use tauri::ipc::Channel;
use ts_rs::TS;

use super::claude::{ClaudeApp, after_task, executable};
use super::gitlab::GitlabApp;
use super::review::{plan_context, sender};
use super::with_store;
use crate::claude::tasks::events::ClaudeTaskEvent;
use crate::claude::tasks::fix::{self, FixRequest};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::fix::eligibility::{FixContext, fix_allowed};
use crate::fix::guard;
use crate::fix::proposal::{self, FixProposal};
use crate::fix::proposals::{Pending, Proposals};
use crate::git::Git;
use crate::git::scratch::{self, Scratch};
use crate::os::process::Cancel;
use crate::review::mr_summary::MrMeta;
use crate::review::{decisions, drafts};
use crate::source::model::Source;
use crate::store::{self, Store};

/// What a fix starts from: a Claude note of the session (S-03) or a kept note (S-05).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FixTarget {
    /// The UI's ID of the run, for `claude_cancel`.
    pub task: String,
    pub session_id: String,
    #[ts(optional)]
    #[serde(default)]
    pub finding_id: Option<String>,
    #[ts(optional)]
    #[serde(default)]
    pub draft_id: Option<String>,
}

/// The note to fix: its file, line and text.
struct Note {
    file: String,
    line: u32,
    request: String,
}

/// The session's repository and the facts `fix_allowed` reads.
struct Session {
    repo_id: i64,
    repo: PathBuf,
    source: Source,
    cx: FixContext,
}

/// Fix with Claude (F-25.2, F-25.3): `started` once Claude runs, then `done` with the
/// proposal. Refused with `FIX_NOT_ALLOWED` before anything starts on code that isn't the
/// user's own (F-25.1).
#[tauri::command]
pub async fn fix_propose(
    claude: State<'_, ClaudeApp>,
    store: State<'_, Store>,
    gitlab: State<'_, GitlabApp>,
    proposals: State<'_, Proposals>,
    target: FixTarget,
    ch: Channel<ClaudeTaskEvent<FixProposal>>,
) -> AppResult<FixProposal> {
    let settings = with_store(&store, |c| store::settings::load(c)).await?;
    let git_program = settings.git.path.clone();
    let me = gitlab.cached_username().await;
    let session = session(&store, &target.session_id, git_program.as_deref(), me).await?;
    fix_allowed(&session.source, &session.cx)?;
    let note = note(&store, &target).await?;
    let exe = executable(&store).await?;
    let ctx = plan_context(&claude, &store, &exe, &settings.claude);
    let git = Git::new(git_program.as_deref().map(Path::new), &session.repo);

    let emit = sender(ch);
    let cancel = Cancel::new();
    claude.track(&target.task, &cancel);
    let id = format!("fix-{}", uuid::Uuid::new_v4().simple());
    let root = claude.tmp_root.join("scratch");
    let result = async {
        let scratch = scratch::create(
            &git,
            &store,
            session.repo_id,
            &root,
            &id,
            Path::new(&note.file),
            &cancel,
        )
        .await?;
        let context = format!("{}, line {}", note.file, note.line);
        let req = FixRequest {
            scratch: &scratch,
            origin: "a self-review note",
            request: &note.request,
            context: &context,
        };
        emit(ClaudeTaskEvent::Queued);
        let started = || emit(ClaudeTaskEvent::Started);
        let run = fix::run(&ctx, &req, &started, &cancel).await;
        after_task(&claude, &store, run.as_ref().map(drop)).await;
        let outcome = match run {
            Ok(outcome) => outcome,
            Err(error) => {
                scratch::remove(&git, &store, &scratch).await;
                return Err(AppError::from(error));
            }
        };
        guard::verify(&git, &store, &scratch, &cancel).await?;
        let built = proposal::build(&git, &scratch, &id, &outcome, &cancel).await;
        keep_or_remove(&git, &store, &proposals, &session.repo, scratch, &built).await;
        built
    }
    .await;
    claude.untrack(&target.task);
    emit(match &result {
        Ok(proposal) => ClaudeTaskEvent::Done {
            result: proposal.clone(),
        },
        Err(error) => ClaudeTaskEvent::Failed {
            error: error.clone(),
        },
    });
    result
}

/// A proposal with an edit keeps its scratch for Accept or Discard (F-25.4); no edit or a
/// failure has nothing to accept, so the scratch goes.
async fn keep_or_remove(
    git: &Git,
    store: &Store,
    proposals: &Proposals,
    repo: &Path,
    scratch: Scratch,
    built: &AppResult<FixProposal>,
) {
    match built {
        Ok(proposal) if !proposal.hunks.is_empty() => {
            let pending = Pending {
                repo: repo.to_path_buf(),
                scratch,
            };
            proposals.keep(&proposal.id, pending);
        }
        _ => scratch::remove(git, store, &scratch).await,
    }
}

fn unknown_session() -> AppError {
    AppError::new(ErrorCode::InvalidInput, "Unknown session.")
}

/// The session's source and the facts `fix_allowed` reads. GitLab is not asked: the MR's
/// author comes from the session, me from the last status.
async fn session(
    store: &Store,
    id: &str,
    git_program: Option<&str>,
    me: Option<String>,
) -> AppResult<Session> {
    let id = id.to_owned();
    let (row, active) = with_store(store, move |c| {
        Ok((
            store::sessions::source_of(c, &id)?,
            store::repos::active(c)?,
        ))
    })
    .await?;
    let row = row.ok_or_else(unknown_session)?;
    let source: Source = serde_json::from_str(&row.source_json).map_err(|e| {
        AppError::internal("The session could not be read.").with_detail(e.to_string())
    })?;
    let Some(active) = active.filter(|a| Some(a.id) == row.repo_id) else {
        // Not the active repository's checkout: never fixed.
        return Ok(Session {
            repo_id: row.repo_id.unwrap_or_default(),
            repo: PathBuf::new(),
            source,
            cx: FixContext::default(),
        });
    };
    let meta: Option<MrMeta> = row
        .mr_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok());
    let checkout_branch = match meta {
        Some(_) => {
            let git = Git::new(git_program.map(Path::new), &active.path);
            git.run(
                ["symbolic-ref", "--quiet", "--short", "HEAD"],
                &Cancel::new(),
            )
            .await
            .ok()
            .map(|o| o.stdout.trim().to_owned())
            .filter(|b| !b.is_empty())
        }
        None => None,
    };
    Ok(Session {
        repo_id: active.id,
        repo: PathBuf::from(&active.path),
        source,
        cx: FixContext {
            active_repository: true,
            me,
            mr_author: meta
                .as_ref()
                .map(|m| m.author.clone())
                .filter(|a| !a.is_empty()),
            mr_source_branch: meta.map(|m| m.source_branch),
            checkout_branch,
        },
    })
}

/// The note the target names, in that session.
async fn note(store: &Store, target: &FixTarget) -> AppResult<Note> {
    let target = target.clone();
    with_store(store, move |c| Ok(note_in(c, &target))).await?
}

fn note_in(conn: &rusqlite::Connection, target: &FixTarget) -> AppResult<Note> {
    if let Some(draft_id) = &target.draft_id {
        let draft = drafts::get(conn, draft_id)?;
        let position = draft
            .position
            .filter(|_| draft.session_id == target.session_id)
            .ok_or_else(|| {
                AppError::new(ErrorCode::InvalidInput, "This note has no file to fix.")
            })?;
        return Ok(Note {
            file: position.file,
            line: position.line,
            request: draft.body,
        });
    }
    let finding_id = target
        .finding_id
        .as_deref()
        .ok_or_else(|| AppError::new(ErrorCode::InvalidInput, "Pick a note to fix."))?;
    let finding = decisions::load_in(conn, &target.session_id, finding_id)?;
    Ok(Note {
        file: finding.file,
        line: finding.line,
        request: format!(
            "{}

{}",
            finding.title, finding.body
        ),
    })
}
