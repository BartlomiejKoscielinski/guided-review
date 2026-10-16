import type { SettingsPatch } from './settings-patch';
import type { ActiveRepo } from './types/ActiveRepo';
import type { AnalysisStatus } from './types/AnalysisStatus';
import type { AppHealth } from './types/AppHealth';
import type { AskAnswer } from './types/AskAnswer';
import type { ClaudeStatus } from './types/ClaudeStatus';
import type { ClaudeTaskEvent } from './types/ClaudeTaskEvent';
import type { DecisionOutcome } from './types/DecisionOutcome';
import type { Draft } from './types/Draft';
import type { DraftPatch } from './types/DraftPatch';
import type { FindingDecision } from './types/FindingDecision';
import type { Layout } from './types/Layout';
import type { Mode } from './types/Mode';
import type { LineSelection } from './types/LineSelection';
import type { NewDraft } from './types/NewDraft';
import type { PlanView } from './types/PlanView';
import type { ResumedSession } from './types/ResumedSession';
import type { SessionState } from './types/SessionState';
import type { StepOrder } from './types/StepOrder';
import type { StepView } from './types/StepView';
import type { Strategy } from './types/Strategy';
import type { StepAnalysis } from './types/StepAnalysis';
import type { CommitInfo } from './types/CommitInfo';
import type { CommitList } from './types/CommitList';
import type { CommitRange } from './types/CommitRange';
import type { DetectedSource } from './types/DetectedSource';
import type { LocalScope } from './types/LocalScope';
import type { OpenedSession } from './types/OpenedSession';
import type { PrepareProgress } from './types/PrepareProgress';
import type { Repo } from './types/Repo';
import type { RiderStatus } from './types/RiderStatus';
import type { SessionMr } from './types/SessionMr';
import type { Source } from './types/Source';
import type { StatusSummary } from './types/StatusSummary';
import type { CommitResult } from './types/CommitResult';
import type { DiffSource } from './types/DiffSource';
import type { FileDiff } from './types/FileDiff';
import type { FileRef } from './types/FileRef';
import type { GitlabStatus } from './types/GitlabStatus';
import type { LocalChanges } from './types/LocalChanges';
import type { ModelInfo } from './types/ModelInfo';
import type { MrList } from './types/MrList';
import type { MrTab } from './types/MrTab';
import type { PushResult } from './types/PushResult';
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
   * Mark reviewed (Space) or its undo (F-07.2); the plan's reviewed steps for the done checks
   * and progress segments (F-07.1). No Claude.
   */
  reviewMarkStep(sessionId: string, stepId: string, reviewed: boolean): Promise<string[]>;
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
  /** Edits the text or the Publish tick; a published draft is refused. */
  draftsUpdate(id: string, patch: DraftPatch): Promise<Draft>;
  draftsDelete(id: string): Promise<void>;

  // S-06 (F-15, F-16).
  /** Local changes with their index state (S-06 local mode). */
  gitStatus(): Promise<LocalChanges>;
  /** A commit's details and files; HEAD without `sha` (F-15.6). */
  gitCommitInfo(sha?: string): Promise<CommitInfo>;
  gitFileDiff(source: DiffSource, file: FileRef): Promise<FileDiff>;
  /** Writes the selection into the git index (F-16.1). */
  gitStage(selection: Selection): Promise<void>;
  gitUnstage(selection: Selection): Promise<void>;
  gitCommit(message: string, amend: boolean): Promise<CommitResult>;
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
  /** Runs the startup checks again. */
  claudeRefresh(): Promise<ClaudeStatus>;
  /** Opens `claude auth login` in its own console window. */
  claudeSignIn(): Promise<void>;
  /** File dialog for the executable (F-18.6); null when cancelled. */
  claudePickExecutable(): Promise<ClaudeStatus | null>;
  /** Models and their effort levels (F-18.2, F-18.4). */
  claudeModels(): Promise<ModelInfo[]>;
  /** Suggest: a commit message from the staged diff; `task` names it for `claudeCancel`. */
  claudeCommitMessage(task: string): Promise<string>;
  claudeCancel(task: string): Promise<void>;

  // GitLab (F-01.6, F-02.1, F-02.2, F-19.2, F-19.5).
  /** Connected / no token / failing; `refresh` checks GitLab again (F-01.6). */
  gitlabStatus(refresh: boolean): Promise<GitlabStatus>;
  /** Check and save / Replace token: stored only if GitLab accepts it with scope api (F-19.5). */
  gitlabAccountSave(server: string, token: string): Promise<GitlabStatus>;
  /** Removes the stored token; the server URL stays. */
  gitlabAccountRemove(): Promise<GitlabStatus>;
  /** One S-01 tab of the active repository's project with the counts of all three tabs. */
  gitlabListMrs(tab: MrTab): Promise<MrList>;

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
