import type { SettingsPatch } from './settings-patch';
import type { ActiveRepo } from './types/ActiveRepo';
import type { AnalysisStatus } from './types/AnalysisStatus';
import type { ApprovalState } from './types/ApprovalState';
import type { SummaryStatus } from './types/SummaryStatus';
import type { AppHealth } from './types/AppHealth';
import type { AskAnswer } from './types/AskAnswer';
import type { AuthorMr } from './types/AuthorMr';
import type { ClaudeActivity } from './types/ClaudeActivity';
import type { ClaudeStatus } from './types/ClaudeStatus';
import type { ClaudeTaskEvent } from './types/ClaudeTaskEvent';
import type { JobArtifact } from './types/JobArtifact';
import type { JobDetailsView } from './types/JobDetailsView';
import type { DecisionOutcome } from './types/DecisionOutcome';
import type { Draft } from './types/Draft';
import type { DraftPatch } from './types/DraftPatch';
import type { FindingDecision } from './types/FindingDecision';
import type { FixProposal } from './types/FixProposal';
import type { FixTarget } from './types/FixTarget';
import type { FixWatchEvent } from './types/FixWatchEvent';
import type { Layout } from './types/Layout';
import type { Mode } from './types/Mode';
import type { LineSelection } from './types/LineSelection';
import type { NewDraft } from './types/NewDraft';
import type { NewMrDraft } from './types/NewMrDraft';
import type { JobLogEvent } from './types/JobLogEvent';
import type { JobRow } from './types/JobRow';
import type { JobVariable } from './types/JobVariable';
import type { PipelineHead } from './types/PipelineHead';
import type { PipelineTab } from './types/PipelineTab';
import type { StageColumn } from './types/StageColumn';
import type { PlanView } from './types/PlanView';
import type { PublishOutcome } from './types/PublishOutcome';
import type { ResumedSession } from './types/ResumedSession';
import type { SessionState } from './types/SessionState';
import type { SessionStatus } from './types/SessionStatus';
import type { StepOrder } from './types/StepOrder';
import type { StepView } from './types/StepView';
import type { Thread } from './types/Thread';
import type { Strategy } from './types/Strategy';
import type { StepAnalysis } from './types/StepAnalysis';
import type { SummaryComment } from './types/SummaryComment';
import type { SummaryField } from './types/SummaryField';
import type { SummaryState } from './types/SummaryState';
import type { ThreadCheck } from './types/ThreadCheck';
import type { CommitInfo } from './types/CommitInfo';
import type { CommitList } from './types/CommitList';
import type { CommitRange } from './types/CommitRange';
import type { DetectedSource } from './types/DetectedSource';
import type { LocalScope } from './types/LocalScope';
import type { OpenedSession } from './types/OpenedSession';
import type { JobExplainEvent } from './types/JobExplainEvent';
import type { JobExplanation } from './types/JobExplanation';
import type { PrepareProgress } from './types/PrepareProgress';
import type { Repo } from './types/Repo';
import type { RiderStatus } from './types/RiderStatus';
import type { SessionMr } from './types/SessionMr';
import type { Source } from './types/Source';
import type { BranchInfo } from './types/BranchInfo';
import type { MergeCheck } from './types/MergeCheck';
import type { StatusSummary } from './types/StatusSummary';
import type { CommitResult } from './types/CommitResult';
import type { DiffSource } from './types/DiffSource';
import type { FileDiff } from './types/FileDiff';
import type { FixupTarget } from './types/FixupTarget';
import type { FileRef } from './types/FileRef';
import type { GitlabStatus } from './types/GitlabStatus';
import type { LocalChanges } from './types/LocalChanges';
import type { ModelInfo } from './types/ModelInfo';
import type { MrDescription } from './types/MrDescription';
import type { MrDescriptionVariant } from './types/MrDescriptionVariant';
import type { MrList } from './types/MrList';
import type { MrTab } from './types/MrTab';
import type { ProjectMember } from './types/ProjectMember';
import type { PushOutcome } from './types/PushOutcome';
import type { PushResult } from './types/PushResult';
import type { QueuedReply } from './types/QueuedReply';
import type { ReplyDraft } from './types/ReplyDraft';
import type { ReviewerSuggestion } from './types/ReviewerSuggestion';
import type { Selection } from './types/Selection';
import type { Route } from './types/Route';
import type { Settings } from './types/Settings';
import type { UnfinishedSession } from './types/UnfinishedSession';

/**
 * The only way the UI talks to the core (docs/04-architecture.md › IPC contract).
 * Implemented by `tauri.ts` (the Rust core) and `mock/` (browser dev and e2e tests);
 * every command exists in both. Failures reject with an `IpcError`.
 */
export interface IpcClient {
  appHealth(): Promise<AppHealth>;
  /** All settings, defaults included (`app_settings_get`). */
  appSettingsGet(): Promise<Settings>;
  /** Applies a partial change and returns the saved settings (`app_settings_set`). */
  appSettingsSet(patch: SettingsPatch): Promise<Settings>;
  /** The screen to open on start: the last one if it can be restored (F-30.4). */
  appStartRoute(): Promise<Route>;
  /** Unfinished review sessions, most recent first (F-30.2). */
  sessionsListUnfinished(): Promise<UnfinishedSession[]>;

  // Repositories (F-19.6, F-30.7).
  /** The active repository: switched to in this run, else the default one; null until picked. */
  repoActive(): Promise<ActiveRepo | null>;
  /** Folder dialog; adds the repository and makes it active (the default if first). Null when cancelled. */
  repoPick(): Promise<ActiveRepo | null>;
  /** The configured repositories with project, default/active flags and worktree folder. */
  repoList(): Promise<Repo[]>;
  /** Switches the active repository of S-01 and S-06 until the app restarts (F-30.7). */
  repoSwitch(id: number): Promise<ActiveRepo>;
  repoSetDefault(id: number): Promise<void>;
  /** Forgets the repository; nothing on disk changes. */
  repoRemove(id: number): Promise<void>;

  // S-01 sources (F-01, F-03).
  /** What the input names, or null for blank input; rejects with the F-01.5 copy. */
  sourceDetect(input: string): Promise<DetectedSource | null>;
  /** Commits of a branch (the current one without `branch`), filtered by message, author or SHA. */
  gitLog(branch?: string, query?: string): Promise<CommitList>;
  /** Counts of the three My changes scopes (F-03.3). */
  gitStatusSummary(): Promise<StatusSummary>;
  /** The S-11 branch block against `target` (a branch on origin; the default when missing). */
  gitBranchInfo(target?: string): Promise<BranchInfo>;
  /**
   * The title S-11 opens with for an MR into `target` (F-27.2, read without Claude): a single
   * commit's subject, or the branch name in words for several; empty with nothing to name it after.
   */
  gitMrTitle(target?: string): Promise<string>;
  /**
   * S-11's "Before you create" for an MR into `target` (F-27.5; the default when missing): the
   * branch on origin at HEAD, the files conflicting with the target (`git merge-tree`), the newest
   * self-review and an open MR of the branch. Reads only.
   */
  gitMergeCheck(target?: string): Promise<MergeCheck>;
  /**
   * S-11's suggested reviewers for an MR into `target` (F-27.3; the default when missing): at most
   * three project members with one reason each (code owner, blame share, review history).
   */
  reviewersSuggest(target?: string): Promise<ReviewerSuggestion[]>;
  /** Project members matching the typed text, never the signed-in user (F-27.3). */
  gitlabUsersSearch(query: string): Promise<ProjectMember[]>;
  /** Step review of a commit or a range `from..to`, `from` excluded (F-01.3, F-03.2). */
  sessionOpenCommit(range: CommitRange): Promise<OpenedSession>;
  /** Self-review of local changes in one scope (F-03.4). */
  sessionOpenLocal(scope: LocalScope): Promise<OpenedSession>;
  /** A typed branch: the current one as local changes, another one as its commits. */
  sessionOpenBranch(branch: string): Promise<OpenedSession>;
  /** A typed repository path: added if needed, made active, then self-review. */
  sessionOpenRepo(path: string): Promise<OpenedSession>;
  /**
   * A teammate's MR (F-01.3, F-05): the repository of `project` (switched to) or the active one,
   * preparation with progress, then S-02. Rejects with the F-01.5 copy for an unknown MR.
   */
  sessionOpenMr(
    iid: number,
    project: string | null,
    task: string,
    onProgress: (progress: PrepareProgress) => void,
  ): Promise<OpenedSession>;
  /** Cancel on S-02 Preparing (F-05.6); the running `sessionOpenMr` rejects with CANCELLED. */
  sessionPrepareCancel(task: string): Promise<void>;
  /**
   * A teammate's MR session as S-02's header and S-06's MR browse show it (F-06.1, F-24.1): the
   * MR as prepared and the files of merge base → head; null for commit or local sessions.
   * Starts no GitLab work.
   */
  sessionMr(sessionId: string): Promise<SessionMr | null>;
  /** What the session reviews (F-17.1): S-02's header of a commit or local session. */
  sessionSource(sessionId: string): Promise<Source>;
  /**
   * Where the session is in its life (F-12.7): S-05 of a "drafts only" session has no steps, so it
   * shows no progress line and no Back to steps. Database only.
   */
  sessionStatus(sessionId: string): Promise<SessionStatus>;

  // S-02 plan (F-06). Claude task events go to `onEvent`.
  /**
   * The session's plan (F-06.2): from the cache `queued` → `done` with `cachedAt` and no
   * `claude`, else `queued`, `started`, then `done` or `failed` (F-06.12).
   */
  reviewPlan(
    sessionId: string,
    onEvent: (event: ClaudeTaskEvent<PlanView>) => void,
  ): Promise<PlanView>;
  /** Contract to UI, Tests first or File order (F-06.4); clears a dragged order. No Claude. */
  reviewSetStrategy(sessionId: string, strategy: Strategy): Promise<StepOrder>;
  /** A dragged order naming every step once (F-06.5); saved in the session. */
  reviewReorderSteps(sessionId: string, stepIds: string[]): Promise<StepOrder>;

  // S-03 steps, questions and decisions (F-09, F-10). Claude task events go to `onEvent`.
  /**
   * A step of the planned session (F-07.2, F-07.3): "STEP n OF m" in the reader's order, its
   * files with only its hunks, the threads inside them, the reviewed flag. No Claude.
   */
  reviewStep(sessionId: string, stepId: string): Promise<StepView>;
  /**
   * A step's notes (F-09.6): `queued`, `started` unless already analyzed, then `done` or
   * `failed`; the next step is prefetched. Notes come with their stored decisions.
   */
  reviewFindings(
    sessionId: string,
    stepId: string,
    onEvent: (event: ClaudeTaskEvent<StepAnalysis>) => void,
  ): Promise<StepAnalysis>;
  /**
   * A question on a step and, if any, the selected lines (F-10.1): `partialText` pieces, then
   * `done` with the whole answer; follow-ups continue the step's Claude session (F-10.2).
   */
  reviewAsk(
    sessionId: string,
    stepId: string,
    question: string,
    selection: LineSelection | null,
    onEvent: (event: ClaudeTaskEvent<AskAnswer>) => void,
  ): Promise<AskAnswer>;
  /**
   * Add to drafts, Edit and add, Dismiss or Undo on a note of the session (F-09.2, F-09.4). Local
   * only. The session names the note: another review can hold a note with the same ID.
   */
  reviewDecide(
    sessionId: string,
    findingId: string,
    decision: FindingDecision,
  ): Promise<DecisionOutcome>;
  /**
   * Mark reviewed or its undo (F-07.2): all the step's files or none (F-07.10); the plan's
   * reviewed steps for the done checks and progress segments (F-07.1). No Claude.
   */
  reviewMarkStep(sessionId: string, stepId: string, reviewed: boolean): Promise<string[]>;
  /**
   * A file's Reviewed toggle or Space (F-07.10): marks or unmarks one file of the step; the step
   * is reviewed when all its files are. The plan's reviewed steps, as `reviewMarkStep`.
   */
  reviewMarkFile(
    sessionId: string,
    stepId: string,
    file: string,
    reviewed: boolean,
  ): Promise<string[]>;
  /**
   * S-04's footer (F-08.8): the session's steps whose analysis is ready, running now or failed,
   * in the reader's order, and the code Claude reads. Caches only: no Claude run.
   */
  reviewAnalysisStatus(sessionId: string): Promise<AnalysisStatus>;

  // S-03 session state (F-04.3): read when S-03 opens, written on change; database only.
  /** The step S-03 was on, the session's layout, scroll per step and checklist ticks. */
  sessionState(sessionId: string): Promise<SessionState>;
  /** The step S-03 is on. */
  sessionSetStep(sessionId: string, stepId: string): Promise<void>;
  /** The layout chosen for the session (F-07.1). */
  sessionSetLayout(sessionId: string, layout: Layout): Promise<void>;
  /**
   * The session's mode from the Focus | Detailed toggle or Ctrl+D (F-08.1); Settings › General ›
   * Start in stays the mode of new sessions (M4 decision 4).
   */
  sessionSetMode(sessionId: string, mode: Mode): Promise<void>;
  /** S-02 showed the session's plan: the S-04 rail's "Change overview" is done (F-08.3). */
  sessionMarkPlanOpened(sessionId: string): Promise<void>;
  /** Where the step was scrolled, in pixels (written debounced). */
  sessionSetScroll(sessionId: string, stepId: string, top: number): Promise<void>;
  /** The step's ticked "For you to judge" items (F-08.7); an empty list unticks all. */
  sessionSetChecklist(sessionId: string, stepId: string, ticked: string[]): Promise<void>;
  /**
   * S-03 restored on start (F-30.4): the cached plan, the step the session was on without the
   * MR's threads, and its notes when they are cached; null when the plan isn't cached. Starts
   * no Claude or GitLab work.
   */
  sessionResume(sessionId: string): Promise<ResumedSession | null>;

  // Drafts (F-09.2, F-10.3): kept on this PC; nothing reaches GitLab without Publish.
  draftsList(sessionId: string): Promise<Draft[]>;
  draftsCreate(draft: NewDraft): Promise<Draft>;
  /**
   * A draft made outside a review (Explain failure on S-08, Add as a question on S-12) of the MR
   * `project` !`iid` (F-12.7): it joins the MR's latest session that isn't done, else a new "drafts
   * only" session that S-05 opens. Database only.
   */
  draftsCreateForMr(project: string, iid: number, draft: NewMrDraft): Promise<Draft>;
  /** Edits the text or the Publish tick; a published draft is refused. */
  draftsUpdate(id: string, patch: DraftPatch): Promise<Draft>;
  draftsDelete(id: string): Promise<void>;
  /**
   * Publish (N) and Retry (F-12.5): the ticked drafts `ids` in the list's order and the summary
   * comment (`null`: none) go out in one batch, so the author gets a single notification. A
   * GitLab failure comes back per draft in `failed`; an unknown draft is refused before anything
   * is sent. The core takes the MR, its reviewed version and the diff from the session.
   */
  draftsPublish(sessionId: string, ids: string[], summary: string | null): Promise<PublishOutcome>;
  /**
   * The summary comment Claude suggests when "Add a summary comment" is ticked (F-12.4, M5
   * decision 11): from the plan, the drafts going out and the open threads; clamped to 600
   * characters. The tick is the explicit action; nothing runs it in the background.
   */
  claudeSummaryComment(
    sessionId: string,
    onEvent: (event: ClaudeTaskEvent<SummaryComment>) => void,
  ): Promise<SummaryComment>;
  /**
   * **Check with Claude** on S-05's Threads tab (F-13.3, M5 decision 12): which of the MR's open
   * threads written on an older version a later commit addressed, as { discussionId, commit (full
   * id), hint }. The core reads the threads from GitLab and the commits since each one's version
   * from the review worktree; without such a thread no Claude run starts. Cached per head and
   * thread set; nothing is resolved. The click is the explicit action; nothing runs it on its own.
   */
  claudeThreadCheck(
    sessionId: string,
    onEvent: (event: ClaudeTaskEvent<ThreadCheck>) => void,
  ): Promise<ThreadCheck>;
  /**
   * The session's "Add a summary comment" tick, text and suggested flag, and `published` once a
   * Publish sent it (F-12.5: never sent again) (database only).
   */
  sessionSummary(sessionId: string): Promise<SummaryState>;
  /** Keeps the tick, the text and the suggested flag as the reviewer left them. */
  sessionSetSummary(sessionId: string, summary: SummaryField): Promise<void>;

  // S-06 (F-15, F-16).
  /** Local changes with their index state (S-06 local mode). */
  gitStatus(): Promise<LocalChanges>;
  /** A commit's details and files; HEAD without `sha` (F-15.6). */
  gitCommitInfo(sha?: string): Promise<CommitInfo>;
  gitFileDiff(source: DiffSource, file: FileRef): Promise<FileDiff>;
  /** Writes the selection into the git index (F-16.1). */
  gitStage(selection: Selection): Promise<void>;
  gitUnstage(selection: Selection): Promise<void>;
  /**
   * Commits what is staged, or amends HEAD (F-16.4). With `only` (S-10, F-26.4) just those files
   * go in, from the working tree, and other staged changes stay staged; `fixup` (a full SHA) makes
   * it "fixup! <subject>" with the message as its body. Never amends with `only`.
   */
  gitCommit(
    message: string,
    amend: boolean,
    fixup?: string | null,
    only?: string[] | null,
  ): Promise<CommitResult>;
  /** HEAD's message, for Amend previous commit. */
  gitLastMessage(): Promise<string | null>;
  gitPush(): Promise<PushResult>;
  /**
   * Opens a repository file in Rider at a 1-based line (F-15.5); with `session`, a teammate's MR
   * opens from the folder `rider.openFrom` picks (F-24.1).
   */
  riderOpen(file: string, line: number, session?: string): Promise<void>;
  /** The Rider install the app uses: `rider.path`, else the detected one (F-24.4). */
  riderStatus(): Promise<RiderStatus>;
  /** Change: file dialog for `rider64.exe`, saved as `rider.path`; null when cancelled (F-24.4). */
  riderPickExecutable(): Promise<RiderStatus | null>;
  /** Calls `listener` when the working tree, index or HEAD changed (F-16.2). */
  onRepoChanged(listener: () => void): Promise<() => void>;

  // Claude Code (F-16.4, F-18).
  /** The latest status: auth status, startup probe, last task result (F-18.1). */
  claudeStatus(): Promise<ClaudeStatus>;
  /** Claude tasks running and waiting in the queue (F-18.8): the title bar spinner. */
  claudeActivity(): Promise<ClaudeActivity>;
  /** Runs the startup checks again. */
  claudeRefresh(): Promise<ClaudeStatus>;
  /** Opens `claude auth login` in its own console window. */
  claudeSignIn(): Promise<void>;
  /** File dialog for the executable (F-18.6); null when cancelled. */
  claudePickExecutable(): Promise<ClaudeStatus | null>;
  /** Models and their effort levels (F-18.2, F-18.4). */
  claudeModels(): Promise<ModelInfo[]>;
  /**
   * **Fix with Claude** on a note of the user's own code (F-25.2, F-25.3): Claude edits the
   * note's one file in a scratch copy; `started`, then `done` with the proposal (no hunks: no
   * change). `target.task` names the run for `claudeCancel`. A teammate's MR is refused with
   * FIX_NOT_ALLOWED (F-25.1). The click is the explicit action; nothing runs it on its own.
   */
  fixPropose(
    target: FixTarget,
    onEvent: (event: ClaudeTaskEvent<FixProposal>) => void,
  ): Promise<FixProposal>;
  /**
   * **Accept** of a fix proposal (F-25.4): writes Claude's edit into the working copy, unstaged,
   * only if the file is unchanged since the run started; otherwise FIX_STALE "The file changed
   * while Claude worked. Run it again." and the proposal stays open. A proposal that is no longer
   * open is INVALID_INPUT.
   */
  fixAccept(id: string): Promise<void>;
  /** **Discard** of a fix proposal (F-25.4): drops it; the working copy is never touched. */
  fixDiscard(id: string): Promise<void>;
  /**
   * **Fix in Rider** (F-26.3): waits for a content change of `file` (repository-relative) in the
   * own checkout; `{ kind: 'changed' }` arrives once. Resolves to the function that ends the watch.
   */
  fixWatch(file: string, onEvent: (event: FixWatchEvent) => void): Promise<() => void>;
  /**
   * Suggest: a commit message from the staged diff; `task` names it for `claudeCancel`. With
   * `only` (S-10, F-26.4) from those files' changes against HEAD instead, what `gitCommit` with
   * the same `only` commits, so other staged changes never reach the message.
   */
  claudeCommitMessage(task: string, only?: string[]): Promise<string>;
  /**
   * S-11 (F-27.2): Write with Claude (`normal`), Shorter version (`short`), Longer version (`long`):
   * the title and the What / Why / How to test description of the current branch into `target`
   * (the default when missing); `task` names it for `claudeCancel`. Runs only on a click.
   */
  claudeMrDescription(
    task: string,
    variant: MrDescriptionVariant,
    target?: string,
  ): Promise<MrDescription>;
  claudeCancel(task: string): Promise<void>;

  // GitLab (F-01.6, F-02.1, F-02.2, F-11.2, F-19.2, F-19.5).
  /** Connected / no token / failing; `refresh` checks GitLab again (F-01.6). */
  gitlabStatus(refresh: boolean): Promise<GitlabStatus>;
  /** Check and save / Replace token: stored only if GitLab accepts it with scope api (F-19.5). */
  gitlabAccountSave(server: string, token: string): Promise<GitlabStatus>;
  /** Removes the stored token; the server URL stays. */
  gitlabAccountRemove(): Promise<GitlabStatus>;
  /** One S-01 tab of the active repository's project with the counts of all three tabs. */
  gitlabListMrs(tab: MrTab): Promise<MrList>;
  /**
   * The threads of the session's MR as GitLab has them now, oldest first (S-05 "Threads N open",
   * F-12.2); read only. Never called on a restored start (F-30.4).
   */
  gitlabDiscussions(sessionId: string): Promise<Thread[]>;
  /**
   * The approval state of the session's MR for the S-05 Approval tile (F-14.1): who approved, how
   * many approvals GitLab asks for, and whether the user approved, may approve, or would need a
   * password. Read only; never called on a restored start (F-30.4).
   */
  gitlabApprovalState(sessionId: string): Promise<ApprovalState>;
  /**
   * The head the session reviewed against the MR's head now (S-05, F-14.2): `changed` shows the
   * banner and disables Approve. Read only; never called on a restored start (F-30.4).
   */
  summaryStatus(sessionId: string): Promise<SummaryStatus>;
  /**
   * Approve MR for the head `sha` the user reviewed (F-14.2): `CONFLICT` for another SHA or when
   * the MR moved on (GitLab's 409). Only ever sent on its own click.
   */
  gitlabApprove(sessionId: string, sha: string): Promise<void>;
  /** Revoke approval: the user's approval of the session's MR is taken back (F-14.2). */
  gitlabUnapprove(sessionId: string): Promise<void>;
  /**
   * Resolve (`resolved` true) or Reopen (false) a thread of the session's MR, sent at once and
   * independent of drafts and approval (F-11.2); the core takes the project and the MR from the
   * session.
   */
  gitlabResolve(sessionId: string, discussionId: string, resolved: boolean): Promise<void>;
  /** Reply: `body` becomes a note of the thread at once, as written; not a draft (F-11.2). */
  gitlabReply(sessionId: string, discussionId: string, body: string): Promise<void>;
  /**
   * The draft comments already in GitLab's own review of the session's MR, which a Publish sends
   * too (F-12.5, M5 decision 8); read only. Never called on a restored start (F-30.4).
   */
  gitlabForeignDrafts(sessionId: string): Promise<number>;

  // S-10 Your MR (F-26). Never called on a restored start (F-30.4).
  /**
   * My MR `iid` of `project` (F-26.1): title, branches, head pipeline and the thread list;
   * someone else's MR is INVALID_INPUT.
   */
  authorMr(project: string, iid: number): Promise<AuthorMr>;
  /**
   * The unified diff of `path` in the active repository from merge-base(origin/`target`, HEAD) to
   * the working tree (F-26.2); no hunks for a file the author didn't change. Read only.
   */
  authorFileDiff(target: string, path: string): Promise<FileDiff>;
  /**
   * The commit a fix of the thread on `line` of `path` is a fixup of (F-26.4, M7 decision 8): the
   * blame of the line in my MR's range, else the newest range commit touching the file, else HEAD.
   * Reads git only.
   */
  authorFixupTarget(target: string, path: string, line: number | null): Promise<FixupTarget>;
  /**
   * The active checkout's uncommitted files (M7 decision 10): HEAD → working tree, staged and
   * untracked included, repository-relative with `/`. S-10 warns before Fix when any is not the
   * thread's file. Reads git only.
   */
  authorUncommittedFiles(): Promise<string[]>;
  /**
   * Queues the reply **Commit** made for `discussion` (F-26.5): `body` "Fixed in <sha>. <one
   * sentence>." sent after the push of `afterSha` (the full SHA), then Resolve when `resolve`.
   * Queueing the thread again replaces it and keeps its ID. Sends nothing. (A property, not a
   * method, so a test can hand it on unbound.)
   */
  authorQueueReply: (
    project: string,
    iid: number,
    discussion: string,
    body: string,
    resolve: boolean,
    afterSha: string,
  ) => Promise<QueuedReply>;
  /**
   * **Push and reply** (F-26.5, M7 decisions 11 and 12): pushes the branch, then sends the queued
   * reply `id` (and Resolve). `pullFirst` when the remote has commits the checkout doesn't have
   * (nothing pushed); a rejection keeps the reply queued for Retry.
   */
  authorPushAndReply: (project: string, iid: number, id: string) => Promise<PushOutcome>;
  /**
   * **Send reply** on a question thread of my MR (F-26.7): `body` becomes my note of `discussion`
   * at once, as written (no queue, no push); the thread stays open until the reviewer resolves it.
   * A blank body is INVALID_INPUT.
   */
  authorReply: (project: string, iid: number, discussion: string, body: string) => Promise<void>;
  /**
   * **Draft with Claude** on a question thread of my MR (F-26.7): a proposed answer from the
   * thread and the code at its line in my checkout (read-only profile, "Questions" group). Fills
   * the text area only; nothing is sent or cached.
   */
  claudeReplyDraft: (project: string, iid: number, discussion: string) => Promise<ReplyDraft>;
  /**
   * The MR pipeline GitLab started for the pushed commit (F-26.6, M7 decision 13): the full `sha`;
   * `null` until GitLab has one for exactly that commit. Read only; S-10 asks after a push only.
   */
  authorPushPipeline: (project: string, iid: number, sha: string) => Promise<PipelineTab | null>;

  // S-08 Pipeline (F-20); Retry and Cancel only on a click. Never called on a restored start (F-30.4).
  /** The MR's pipelines newest first, each with its MR version ("version 3 · latest", F-20.1). */
  pipelineList(project: string, iid: number): Promise<PipelineTab[]>;
  /** The status block and meta line of pipeline `id` of the MR (F-20.1). */
  pipelineGet(project: string, iid: number, id: number): Promise<PipelineHead>;
  /** The stage columns of pipeline `pipeline` of the MR, retried attempts hidden (F-20.2). */
  pipelineJobs(project: string, iid: number, pipeline: number): Promise<StageColumn[]>;
  /** Retries job `job` at once (F-20.2, decision 6); the row of the new attempt (a new id). */
  jobRetry(project: string, iid: number, job: number): Promise<JobRow>;
  /** Cancels job `job` at once (F-20.2, decision 6); the row as GitLab now has it. */
  jobCancel(project: string, iid: number, job: number): Promise<JobRow>;
  /**
   * Plays manual job `job` with the variables for this run (F-20.6, decision 11); only the form's
   * Run `<job>` calls it. After GitLab accepted it they are that job name's last values.
   */
  jobPlay(project: string, iid: number, job: number, vars: JobVariable[]): Promise<JobRow>;
  /** The variables job `jobName` of `project` last ran with on this machine (F-20.6). */
  jobVariablesGet(project: string, jobName: string): Promise<JobVariable[]>;
  /** The MR's full head SHA, read when Run new pipeline's confirmation opens (F-20.3). */
  pipelineMrHead(project: string, iid: number): Promise<string>;
  /** Starts a new merge request pipeline after the user confirmed; the new latest tab (F-20.3). */
  pipelineRunMr(project: string, iid: number): Promise<PipelineTab>;
  /** Retry failed jobs of pipeline `id` at once (F-20.4); its head as it now is. */
  pipelineRetry(project: string, iid: number, id: number): Promise<PipelineHead>;
  /** Cancel pipeline `id` at once (F-20.4); its head as it now is. */
  pipelineCancel(project: string, iid: number, id: number): Promise<PipelineHead>;
  /**
   * Explain failure of failed job `job` (F-20.7, M6 decisions 12 and 14), only on its click: the
   * review worktree is prepared (`preparing`), then Claude reads the log, the test report, the
   * MR diff and the MR's pipelines (`reading`), then `done` or `failed`. Nothing is posted; a
   * repeat for the same job comes from the cache.
   */
  jobExplain(
    project: string,
    iid: number,
    job: number,
    onEvent: (event: JobExplainEvent) => void,
  ): Promise<JobExplanation>;
  /**
   * The log of job `job` (F-20.5, decision 10): `onEvent` gets the whole log first (`replace`),
   * then only new lines while the job runs (re-read every 3 s); settles when the stream ends
   * (`done`, or `signal` aborted: another job picked, the screen left). Read only.
   */
  jobTrace(
    project: string,
    iid: number,
    job: number,
    onEvent: (event: JobLogEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  /**
   * The files of successful job `job` (F-20.8, M6 decision 13) without its log and GitLab's
   * index: name, size label ("48 MB") and the download URL Download opens in the browser.
   */
  jobArtifacts(project: string, iid: number, job: number): Promise<JobArtifact[]>;
  /**
   * The details panel's facts about failed job `job` (F-20.9, M6 decision 15):
   * `retriedSameFailure` when its previous attempt in the same pipeline failed on exactly the
   * same tests.
   */
  jobDetails(project: string, iid: number, job: number): Promise<JobDetailsView>;
  /**
   * Opens a page of the configured GitLab in the default browser (Open in GitLab, F-20.4); the
   * core refuses anything that is not `https` on the GitLab host (INVALID_INPUT).
   */
  osOpenGitlabUrl(url: string): Promise<void>;

  // Window controls for the custom title bar (F-30.1); components never call Tauri directly.
  windowMinimize(): Promise<void>;
  windowToggleMaximize(): Promise<void>;
  windowClose(): Promise<void>;
  /** Starts a native window move (drag on the title bar, Snap included). */
  windowStartDragging(): Promise<void>;
  windowIsMaximized(): Promise<boolean>;
  /** Calls `listener` when the window is maximized or restored; resolves to an unsubscribe. */
  onWindowMaximizedChange(listener: (maximized: boolean) => void): Promise<() => void>;
}

/** Picks the implementation: the mock backend in `npm run dev:mock`, the Rust core otherwise. */
export async function createIpcClient(): Promise<IpcClient> {
  if (import.meta.env.VITE_IPC === 'mock') {
    const { createMockClient } = await import('./mock');
    return createMockClient({ storage: window.localStorage });
  }
  const { createTauriClient } = await import('./tauri');
  return createTauriClient();
}
