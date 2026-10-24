import { Channel, invoke, type InvokeArgs } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ApprovalState } from './types/ApprovalState';
import type { SummaryStatus } from './types/SummaryStatus';
import type { IpcClient } from './client';
import { toIpcError } from './errors';
import { createTauriWindowControls } from './tauri-window';
import type { ActiveRepo } from './types/ActiveRepo';
import type { AnalysisStatus } from './types/AnalysisStatus';
import type { AppHealth } from './types/AppHealth';
import type { AskAnswer } from './types/AskAnswer';
import type { AuthorMr } from './types/AuthorMr';
import type { ClaudeActivity } from './types/ClaudeActivity';
import type { ClaudeStatus } from './types/ClaudeStatus';
import type { ClaudeTaskEvent } from './types/ClaudeTaskEvent';
import type { DecisionOutcome } from './types/DecisionOutcome';
import type { Draft } from './types/Draft';
import type { FixProposal } from './types/FixProposal';
import type { FixWatchEvent } from './types/FixWatchEvent';
import type { PublishOutcome } from './types/PublishOutcome';
import type { JobExplainEvent } from './types/JobExplainEvent';
import type { JobArtifact } from './types/JobArtifact';
import type { JobDetailsView } from './types/JobDetailsView';
import type { JobExplanation } from './types/JobExplanation';
import type { JobLogEvent } from './types/JobLogEvent';
import type { JobRow } from './types/JobRow';
import type { JobVariable } from './types/JobVariable';
import type { PipelineHead } from './types/PipelineHead';
import type { PipelineTab } from './types/PipelineTab';
import type { StageColumn } from './types/StageColumn';
import type { PlanView } from './types/PlanView';
import type { ResumedSession } from './types/ResumedSession';
import type { SessionState } from './types/SessionState';
import type { SessionStatus } from './types/SessionStatus';
import type { StepAnalysis } from './types/StepAnalysis';
import type { StepOrder } from './types/StepOrder';
import type { StepView } from './types/StepView';
import type { SummaryComment } from './types/SummaryComment';
import type { SummaryState } from './types/SummaryState';
import type { Thread } from './types/Thread';
import type { ThreadCheck } from './types/ThreadCheck';
import type { CommitInfo } from './types/CommitInfo';
import type { CommitList } from './types/CommitList';
import type { DetectedSource } from './types/DetectedSource';
import type { OpenedSession } from './types/OpenedSession';
import type { PrepareProgress } from './types/PrepareProgress';
import type { Repo } from './types/Repo';
import type { RiderStatus } from './types/RiderStatus';
import type { SessionMr } from './types/SessionMr';
import type { Source } from './types/Source';
import type { BranchInfo } from './types/BranchInfo';
import type { MergeCheck } from './types/MergeCheck';
import type { StatusSummary } from './types/StatusSummary';
import type { CommitResult } from './types/CommitResult';
import type { FileDiff } from './types/FileDiff';
import type { FixupTarget } from './types/FixupTarget';
import type { GitlabStatus } from './types/GitlabStatus';
import type { LocalChanges } from './types/LocalChanges';
import type { ModelInfo } from './types/ModelInfo';
import type { MrDescription } from './types/MrDescription';
import type { MrList } from './types/MrList';
import type { CreatedMr } from './types/CreatedMr';
import type { CreateMrRequest } from './types/CreateMrRequest';
import type { ProjectMember } from './types/ProjectMember';
import type { PushOutcome } from './types/PushOutcome';
import type { PushResult } from './types/PushResult';
import type { QueuedReply } from './types/QueuedReply';
import type { ReplyDraft } from './types/ReplyDraft';
import type { ReviewerSuggestion } from './types/ReviewerSuggestion';
import type { Route } from './types/Route';
import type { Settings } from './types/Settings';
import type { UnfinishedSession } from './types/UnfinishedSession';

async function call<T>(command: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw toIpcError(error);
  }
}

/** Core event names (`app.emit` in the Rust core). */
export const EVENTS = { repoChanged: 'repo_changed' } as const;

/** IPC client backed by the Rust core (Tauri commands). */
export function createTauriClient(): IpcClient {
  return {
    appHealth: () => call<AppHealth>('app_health'),
    appSettingsGet: () => call<Settings>('app_settings_get'),
    appSettingsSet: (patch) => call<Settings>('app_settings_set', { patch }),
    appStartRoute: () => call<Route>('app_start_route'),
    sessionsListUnfinished: () => call<UnfinishedSession[]>('sessions_list_unfinished'),
    repoActive: () => call<ActiveRepo | null>('repo_active'),
    repoPick: () => call<ActiveRepo | null>('repo_pick'),
    repoList: () => call<Repo[]>('repo_list'),
    repoSwitch: (id) => call<ActiveRepo>('repo_switch', { id }),
    repoSetDefault: (id) => call<undefined>('repo_set_default', { id }),
    repoRemove: (id) => call<undefined>('repo_remove', { id }),
    sourceDetect: (input) => call<DetectedSource | null>('source_detect', { input }),
    gitLog: (branch, query) =>
      call<CommitList>('git_log', { branch: branch ?? null, query: query ?? null }),
    gitStatusSummary: () => call<StatusSummary>('git_status_summary'),
    gitBranchInfo: (target) => call<BranchInfo>('git_branch_info', { target: target ?? null }),
    gitMrTitle: (target) => call<string>('git_mr_title', { target: target ?? null }),
    gitMergeCheck: (target) => call<MergeCheck>('git_merge_check', { target: target ?? null }),
    reviewersSuggest: (target) =>
      call<ReviewerSuggestion[]>('reviewers_suggest', { target: target ?? null }),
    gitlabUsersSearch: (query) => call<ProjectMember[]>('gitlab_users_search', { query }),
    gitlabCreateMr: (request) => call<CreatedMr>('gitlab_create_mr', { request }),
    sessionOpenCommit: (range) => call<OpenedSession>('session_open_commit', { range }),
    sessionOpenLocal: (scope) => call<OpenedSession>('session_open_local', { scope }),
    sessionOpenBranch: (branch) => call<OpenedSession>('session_open_branch', { branch }),
    sessionOpenRepo: (path) => call<OpenedSession>('session_open_repo', { path }),
    sessionOpenMr: (iid, project, task, onProgress) => {
      const ch = new Channel<PrepareProgress>();
      ch.onmessage = onProgress;
      return call<OpenedSession>('session_open_mr', { iid, project, task, ch });
    },
    sessionPrepareCancel: (task) => call<undefined>('session_prepare_cancel', { task }),
    sessionMr: (sessionId) => call<SessionMr | null>('session_mr', { sessionId }),
    sessionSource: (sessionId) => call<Source>('session_source', { sessionId }),
    sessionStatus: (sessionId) => call<SessionStatus>('session_status', { sessionId }),
    reviewPlan: (sessionId, onEvent) => {
      const ch = new Channel<ClaudeTaskEvent<PlanView>>();
      ch.onmessage = onEvent;
      return call<PlanView>('review_plan', { session: sessionId, ch });
    },
    reviewSetStrategy: (sessionId, strategy) =>
      call<StepOrder>('review_set_strategy', { session: sessionId, strategy }),
    reviewReorderSteps: (sessionId, stepIds) =>
      call<StepOrder>('review_reorder_steps', { session: sessionId, order: stepIds }),
    reviewStep: (sessionId, stepId) =>
      call<StepView>('review_step', { session: sessionId, step: stepId }),
    reviewFindings: (sessionId, stepId, onEvent) => {
      const ch = new Channel<ClaudeTaskEvent<StepAnalysis>>();
      ch.onmessage = onEvent;
      return call<StepAnalysis>('review_findings', { session: sessionId, step: stepId, ch });
    },
    reviewAsk: (sessionId, stepId, question, selection, onEvent) => {
      const ch = new Channel<ClaudeTaskEvent<AskAnswer>>();
      ch.onmessage = onEvent;
      return call<AskAnswer>('review_ask', {
        session: sessionId,
        step: stepId,
        question,
        selection,
        ch,
      });
    },
    reviewDecide: (sessionId, findingId, decision) =>
      call<DecisionOutcome>('review_decide', { session: sessionId, finding: findingId, decision }),
    reviewMarkStep: (sessionId, stepId, reviewed) =>
      call<string[]>('review_mark_step', { session: sessionId, step: stepId, reviewed }),
    reviewMarkFile: (sessionId, stepId, file, reviewed) =>
      call<string[]>('review_mark_file', { session: sessionId, step: stepId, file, reviewed }),
    reviewAnalysisStatus: (sessionId) =>
      call<AnalysisStatus>('review_analysis_status', { session: sessionId }),
    sessionState: (sessionId) => call<SessionState>('session_state', { session: sessionId }),
    sessionSetStep: (sessionId, stepId) =>
      call<undefined>('session_set_step', { session: sessionId, step: stepId }),
    sessionSetLayout: (sessionId, layout) =>
      call<undefined>('session_set_layout', { session: sessionId, layout }),
    sessionSetMode: (sessionId, mode) =>
      call<undefined>('session_set_mode', { session: sessionId, mode }),
    sessionMarkPlanOpened: (sessionId) =>
      call<undefined>('session_mark_plan_opened', { session: sessionId }),
    sessionSetScroll: (sessionId, stepId, top) =>
      call<undefined>('session_set_scroll', { session: sessionId, step: stepId, top }),
    sessionSetChecklist: (sessionId, stepId, ticked) =>
      call<undefined>('session_set_checklist', { session: sessionId, step: stepId, ticked }),
    sessionResume: (sessionId) =>
      call<ResumedSession | null>('session_resume', { session: sessionId }),
    draftsList: (sessionId) => call<Draft[]>('drafts_list', { sessionId }),
    draftsCreate: (draft) => call<Draft>('drafts_create', { draft }),
    draftsCreateForMr: (project, iid, draft) =>
      call<Draft>('drafts_create_for_mr', { project, iid, draft }),
    draftsUpdate: (id, patch) => call<Draft>('drafts_update', { id, patch }),
    draftsDelete: (id) => call<undefined>('drafts_delete', { id }),
    draftsPublish: (session, ids, summary) =>
      call<PublishOutcome>('drafts_publish', { session, ids, summary }),
    claudeSummaryComment: (sessionId, onEvent) => {
      const ch = new Channel<ClaudeTaskEvent<SummaryComment>>();
      ch.onmessage = onEvent;
      return call<SummaryComment>('claude_summary_comment', { session: sessionId, ch });
    },
    claudeThreadCheck: (sessionId, onEvent) => {
      const ch = new Channel<ClaudeTaskEvent<ThreadCheck>>();
      ch.onmessage = onEvent;
      return call<ThreadCheck>('claude_thread_check', { session: sessionId, ch });
    },
    sessionSummary: (sessionId) => call<SummaryState>('session_summary', { session: sessionId }),
    sessionSetSummary: (sessionId, summary) =>
      call<undefined>('session_set_summary', { session: sessionId, summary }),
    gitStatus: () => call<LocalChanges>('git_status'),
    gitCommitInfo: (sha) => call<CommitInfo>('git_commit_info', { sha: sha ?? null }),
    gitFileDiff: (source, file) => call<FileDiff>('git_file_diff', { source, file }),
    gitStage: (selection) => call<undefined>('git_stage', { selection }),
    gitUnstage: (selection) => call<undefined>('git_unstage', { selection }),
    gitCommit: (message, amend, fixup, only) =>
      call<CommitResult>('git_commit', {
        message,
        amend,
        fixup: fixup ?? null,
        only: only ?? null,
      }),
    gitLastMessage: () => call<string | null>('git_last_message'),
    gitPush: () => call<PushResult>('git_push'),
    riderOpen: (file, line, session) =>
      call<undefined>('rider_open', { file, line, session: session ?? null }),
    riderStatus: () => call<RiderStatus>('rider_status'),
    riderPickExecutable: () => call<RiderStatus | null>('rider_pick_executable'),
    onRepoChanged: async (listener) => {
      try {
        return await listen(EVENTS.repoChanged, () => {
          listener();
        });
      } catch (error: unknown) {
        throw toIpcError(error);
      }
    },
    claudeStatus: () => call<ClaudeStatus>('claude_status'),
    claudeActivity: () => call<ClaudeActivity>('claude_activity'),
    claudeRefresh: () => call<ClaudeStatus>('claude_refresh'),
    claudeSignIn: () => call<undefined>('claude_sign_in'),
    claudePickExecutable: () => call<ClaudeStatus | null>('claude_pick_executable'),
    claudeModels: () => call<ModelInfo[]>('claude_models'),
    claudeCommitMessage: (task, only) =>
      call<string>('claude_commit_message', { task, only: only ?? null }),
    claudeMrDescription: (task, variant, target) =>
      call<MrDescription>('claude_mr_description', { task, variant, target: target ?? null }),
    fixPropose: (target, onEvent) => {
      const ch = new Channel<ClaudeTaskEvent<FixProposal>>();
      ch.onmessage = onEvent;
      return call<FixProposal>('fix_propose', { target, ch });
    },
    fixAccept: (id) => call<undefined>('fix_accept', { id }),
    fixDiscard: (id) => call<undefined>('fix_discard', { id }),
    fixWatch: async (file, onEvent) => {
      const ch = new Channel<FixWatchEvent>();
      ch.onmessage = onEvent;
      const id = await call<string>('fix_watch', { file, ch });
      return () => {
        call<undefined>('fix_watch_stop', { id }).catch(() => undefined);
      };
    },
    claudeCancel: (task) => call<undefined>('claude_cancel', { task }),
    gitlabStatus: (refresh) => call<GitlabStatus>('gitlab_status', { refresh }),
    gitlabAccountSave: (server, token) =>
      call<GitlabStatus>('gitlab_account_save', { server, token }),
    gitlabAccountRemove: () => call<GitlabStatus>('gitlab_account_remove'),
    gitlabListMrs: (tab) => call<MrList>('gitlab_list_mrs', { tab }),
    gitlabDiscussions: (session) => call<Thread[]>('gitlab_discussions', { session }),
    gitlabApprovalState: (session) => call<ApprovalState>('gitlab_approval_state', { session }),
    summaryStatus: (session) => call<SummaryStatus>('summary_status', { session }),
    gitlabApprove: (session, sha) => call<undefined>('gitlab_approve', { session, sha }),
    gitlabUnapprove: (session) => call<undefined>('gitlab_unapprove', { session }),
    gitlabResolve: (session, discussion, resolved) =>
      call<undefined>('gitlab_resolve', { session, discussion, resolved }),
    gitlabReply: (session, discussion, body) =>
      call<undefined>('gitlab_reply', { session, discussion, body }),
    gitlabForeignDrafts: (session) => call<number>('gitlab_foreign_drafts', { session }),
    pipelineList: (project, iid) => call<PipelineTab[]>('pipeline_list', { project, iid }),
    pipelineGet: (project, iid, id) => call<PipelineHead>('pipeline_get', { project, iid, id }),
    authorMr: (project, iid) => call<AuthorMr>('author_mr', { project, iid }),
    authorFileDiff: (target, path) => call<FileDiff>('author_file_diff', { target, path }),
    authorFixupTarget: (target, path, line) =>
      call<FixupTarget>('author_fixup_target', { target, path, line }),
    authorUncommittedFiles: () => call<string[]>('author_uncommitted_files'),
    authorQueueReply: (project, iid, discussion, body, resolve, afterSha) =>
      call<QueuedReply>('author_queue_reply', {
        project,
        iid,
        discussion,
        body,
        resolve,
        afterSha,
      }),
    authorPushAndReply: (project, iid, id) =>
      call<PushOutcome>('author_push_and_reply', { project, iid, replyId: id }),
    authorReply: (project, iid, discussion, body) =>
      call<undefined>('author_reply', { project, iid, discussion, body }),
    claudeReplyDraft: (project, iid, discussion) =>
      call<ReplyDraft>('claude_reply_draft', { project, iid, discussion }),
    authorPushPipeline: (project, iid, sha) =>
      call<PipelineTab | null>('author_push_pipeline', { project, iid, sha }),
    pipelineJobs: (project, iid, pipeline) =>
      call<StageColumn[]>('pipeline_jobs', { project, iid, pipeline }),
    jobRetry: (project, iid, job) => call<JobRow>('job_retry', { project, iid, job }),
    jobCancel: (project, iid, job) => call<JobRow>('job_cancel', { project, iid, job }),
    jobPlay: (project, iid, job, vars) => call<JobRow>('job_play', { project, iid, job, vars }),
    jobVariablesGet: (project, jobName) =>
      call<JobVariable[]>('job_variables_get', { project, jobName }),
    pipelineMrHead: (project, iid) => call<string>('pipeline_mr_head', { project, iid }),
    pipelineRunMr: (project, iid) => call<PipelineTab>('pipeline_run_mr', { project, iid }),
    pipelineRetry: (project, iid, id) => call<PipelineHead>('pipeline_retry', { project, iid, id }),
    pipelineCancel: (project, iid, id) =>
      call<PipelineHead>('pipeline_cancel', { project, iid, id }),
    jobExplain: (project, iid, job, onEvent) => {
      const ch = new Channel<JobExplainEvent>();
      ch.onmessage = onEvent;
      return call<JobExplanation>('job_explain', { project, iid, job, ch });
    },
    jobTrace: async (project, iid, job, onEvent, signal) => {
      if (signal?.aborted) return;
      const task = crypto.randomUUID();
      const ch = new Channel<JobLogEvent>();
      ch.onmessage = (event) => {
        if (!signal?.aborted) onEvent(event);
      };
      const stop = () => {
        call<undefined>('job_trace_stop', { task }).catch(() => undefined);
      };
      signal?.addEventListener('abort', stop, { once: true });
      try {
        await call<undefined>('job_trace', { project, iid, job, task, ch });
      } finally {
        signal?.removeEventListener('abort', stop);
      }
    },
    jobArtifacts: (project, iid, job) =>
      call<JobArtifact[]>('job_artifacts', { project, iid, job }),
    jobDetails: (project, iid, job) => call<JobDetailsView>('job_details', { project, iid, job }),
    osOpenGitlabUrl: (url) => call<undefined>('os_open_gitlab_url', { url }),
    ...createTauriWindowControls(),
  };
}
