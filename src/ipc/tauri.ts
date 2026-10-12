import { invoke, type InvokeArgs } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { IpcClient } from './client';
import { toIpcError } from './errors';
import { createTauriWindowControls } from './tauri-window';
import type { ActiveRepo } from './types/ActiveRepo';
import type { AppHealth } from './types/AppHealth';
import type { ClaudeStatus } from './types/ClaudeStatus';
import type { CommitInfo } from './types/CommitInfo';
import type { CommitResult } from './types/CommitResult';
import type { FileDiff } from './types/FileDiff';
import type { LocalChanges } from './types/LocalChanges';
import type { ModelInfo } from './types/ModelInfo';
import type { PushResult } from './types/PushResult';
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
    gitStatus: () => call<LocalChanges>('git_status'),
    gitCommitInfo: (sha) => call<CommitInfo>('git_commit_info', { sha: sha ?? null }),
    gitFileDiff: (source, file) => call<FileDiff>('git_file_diff', { source, file }),
    gitStage: (selection) => call<undefined>('git_stage', { selection }),
    gitUnstage: (selection) => call<undefined>('git_unstage', { selection }),
    gitCommit: (message, amend) => call<CommitResult>('git_commit', { message, amend }),
    gitLastMessage: () => call<string | null>('git_last_message'),
    gitPush: () => call<PushResult>('git_push'),
    riderOpen: (file, line) => call<undefined>('rider_open', { file, line }),
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
    claudeRefresh: () => call<ClaudeStatus>('claude_refresh'),
    claudeSignIn: () => call<undefined>('claude_sign_in'),
    claudePickExecutable: () => call<ClaudeStatus | null>('claude_pick_executable'),
    claudeModels: () => call<ModelInfo[]>('claude_models'),
    claudeCommitMessage: (task) => call<string>('claude_commit_message', { task }),
    claudeCancel: (task) => call<undefined>('claude_cancel', { task }),
    ...createTauriWindowControls(),
  };
}
