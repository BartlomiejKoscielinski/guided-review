import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { ClaudeStatus } from '../types/ClaudeStatus';
import type { ClaudeTaskEvent } from '../types/ClaudeTaskEvent';
import type { ModelInfo } from '../types/ModelInfo';
import type { SummaryComment } from '../types/SummaryComment';
import type { Thread } from '../types/Thread';
import type { ThreadCheck } from '../types/ThreadCheck';
import { isThreadCheckCandidate, MOCK_THREAD_CHECK_MS, mockThreadHints } from './threadCheck';

/** Variations of the Claude part of the mock (`MOCK_CLAUDE_KEY`). */
export interface ClaudeScenario {
  /** The status reported at start. */
  state?: ClaudeStatus['state'];
  /** Suggest fails like a usage limit (F-18.7) or a sign-in problem. */
  suggestFails?: 'limited' | 'notSignedIn';
}

type ClaudeClient = Pick<
  IpcClient,
  | 'claudeStatus'
  | 'claudeRefresh'
  | 'claudeSignIn'
  | 'claudePickExecutable'
  | 'claudeModels'
  | 'claudeCommitMessage'
  | 'claudeSummaryComment'
  | 'claudeThreadCheck'
  | 'claudeCancel'
>;

const EFFORTS: ModelInfo['efforts'] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** The core's model table (`claude/models.rs`). */
export const MOCK_MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: EFFORTS },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: EFFORTS },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', efforts: EFFORTS },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: EFFORTS },
];

/** Changes.dc.html's suggestion. */
export const SUGGESTION = [
  'Enable compiled bindings in app pages',
  '',
  '- Add x:DataType to pages and views',
  '- Initialize string properties for nullable bindings',
  '- Replace ViewModelLocator with DI registrations',
  '- Update converters to nullable signatures',
].join('\n');

/** `summary` of SummaryDesk.dc.html: what "Add a summary comment" is prefilled with (F-12.4). */
export const SUMMARY_COMMENT =
  'Thanks, the offline queue approach looks good. Before merging: handle camera cancellation, refresh the counter after uploads, and cap retries in UploadWorker.';

/** How long the mock writes the summary, so "Claude is writing a summary…" is visible. */
export const MOCK_SUMMARY_MS = 1100;

/** Reset time shown with "Claude usage limit reached": today 15:32 local time. */
function resetAt(): number {
  const d = new Date();
  d.setHours(15, 32, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function failure(code: 'CLAUDE_LIMITED' | 'CLAUDE_NOT_SIGNED_IN' | 'CANCELLED', message: string) {
  return new IpcError({ code, message, retryable: code === 'CLAUDE_LIMITED' });
}

/** The plan of an MR session is ready (the core loads the session's cached plan first). */
export type PlanReady = (sessionId: string) => boolean;

/** The MR's threads as the core reads them from GitLab, with its guards (`gitlab_discussions`). */
export type MrThreads = (sessionId: string) => Promise<Thread[]>;

/** The Claude part of the mock backend (Settings.dc.html: signed in, native install). */
export function createClaudeBackend(
  scenario: ClaudeScenario,
  respond: <T>(value: T) => Promise<T>,
  wait: (ms: number) => Promise<void>,
  planReady: PlanReady = () => true,
  mrThreads: MrThreads = () => Promise.resolve([]),
): ClaudeClient {
  let status: ClaudeStatus = {
    state: scenario.state ?? 'signedIn',
    path: 'C:\\Users\\dev\\.local\\bin\\claude.exe',
    version: '2.1.296',
    ...(scenario.state === 'limited' ? { resetsAt: resetAt() } : {}),
  };
  const cancelled = new Set<string>();
  /** A usage limit or a sign-in problem, as the core's `after_task` updates the status. */
  const suggestFailure = (): IpcError | null => {
    if (scenario.suggestFails === 'limited') {
      status = { ...status, state: 'limited', resetsAt: resetAt() };
      return failure('CLAUDE_LIMITED', 'Claude usage limit reached');
    }
    if (scenario.suggestFails === 'notSignedIn') {
      status = { ...status, state: 'notSignedIn' };
      return failure('CLAUDE_NOT_SIGNED_IN', 'Claude Code: not signed in');
    }
    status = { ...status, state: 'signedIn' };
    return null;
  };
  return {
    claudeStatus: () => respond(status),
    claudeRefresh: () => {
      if (status.state === 'notSignedIn') status = { ...status, state: 'signedIn' };
      return respond(status);
    },
    claudeSignIn: () => respond(undefined),
    claudePickExecutable: () => respond(status),
    claudeModels: () => respond(MOCK_MODELS),
    claudeCommitMessage: async (task) => {
      await wait(1100);
      if (cancelled.has(task)) throw failure('CANCELLED', 'Cancelled.');
      const failed = suggestFailure();
      if (failed) throw failed;
      return respond(SUGGESTION);
    },
    // F-12.4: as `claude_summary_comment`: the plan first, then queued, started, done or failed.
    claudeSummaryComment: async (sessionId, onEvent) => {
      if (!planReady(sessionId)) {
        throw new IpcError({
          code: 'INVALID_INPUT',
          message: "The plan isn't ready yet.",
          retryable: false,
        });
      }
      onEvent({ kind: 'queued' });
      onEvent({ kind: 'started' });
      await wait(MOCK_SUMMARY_MS);
      const failed = suggestFailure();
      if (failed) {
        onEvent({
          kind: 'failed',
          error: { code: failed.code, message: failed.message, retryable: failed.retryable },
        });
        throw failed;
      }
      const result: SummaryComment = { summary: SUMMARY_COMMENT };
      const done: ClaudeTaskEvent<SummaryComment> = { kind: 'done', result };
      onEvent(done);
      return respond(result);
    },
    // F-13.3: as `claude_thread_check`: the MR's threads first (no MR, no GitLab account), then
    // queued; without a candidate done at once (no Claude run), else started, done or failed.
    claudeThreadCheck: async (sessionId, onEvent) => {
      const threads = await mrThreads(sessionId);
      onEvent({ kind: 'queued' });
      if (!threads.some((t) => isThreadCheckCandidate(t))) {
        const none: ThreadCheck = { hints: [] };
        onEvent({ kind: 'done', result: none });
        return respond(none);
      }
      onEvent({ kind: 'started' });
      await wait(MOCK_THREAD_CHECK_MS);
      const failed = suggestFailure();
      if (failed) {
        onEvent({
          kind: 'failed',
          error: { code: failed.code, message: failed.message, retryable: failed.retryable },
        });
        throw failed;
      }
      const result: ThreadCheck = { hints: mockThreadHints(threads) };
      onEvent({ kind: 'done', result });
      return respond(result);
    },
    claudeCancel: (task) => {
      cancelled.add(task);
      return respond(undefined);
    },
  };
}
