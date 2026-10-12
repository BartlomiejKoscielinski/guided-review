import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { ClaudeStatus } from '../types/ClaudeStatus';
import type { ModelInfo } from '../types/ModelInfo';

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

/** Reset time shown with "Claude usage limit reached": today 15:32 local time. */
function resetAt(): number {
  const d = new Date();
  d.setHours(15, 32, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function failure(code: 'CLAUDE_LIMITED' | 'CLAUDE_NOT_SIGNED_IN' | 'CANCELLED', message: string) {
  return new IpcError({ code, message, retryable: code === 'CLAUDE_LIMITED' });
}

/** The Claude part of the mock backend (Settings.dc.html: signed in, native install). */
export function createClaudeBackend(
  scenario: ClaudeScenario,
  respond: <T>(value: T) => Promise<T>,
  wait: (ms: number) => Promise<void>,
): ClaudeClient {
  let status: ClaudeStatus = {
    state: scenario.state ?? 'signedIn',
    path: 'C:\\Users\\dev\\.local\\bin\\claude.exe',
    version: '2.1.296',
    ...(scenario.state === 'limited' ? { resetsAt: resetAt() } : {}),
  };
  const cancelled = new Set<string>();
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
      if (scenario.suggestFails === 'limited') {
        status = { ...status, state: 'limited', resetsAt: resetAt() };
        throw failure('CLAUDE_LIMITED', 'Claude usage limit reached');
      }
      if (scenario.suggestFails === 'notSignedIn') {
        status = { ...status, state: 'notSignedIn' };
        throw failure('CLAUDE_NOT_SIGNED_IN', 'Claude Code: not signed in');
      }
      status = { ...status, state: 'signedIn' };
      return respond(SUGGESTION);
    },
    claudeCancel: (task) => {
      cancelled.add(task);
      return respond(undefined);
    },
  };
}
