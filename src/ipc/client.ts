import type { SettingsPatch } from './settings-patch';
import type { ActiveRepo } from './types/ActiveRepo';
import type { AppHealth } from './types/AppHealth';
import type { CommitInfo } from './types/CommitInfo';
import type { CommitResult } from './types/CommitResult';
import type { DiffSource } from './types/DiffSource';
import type { FileDiff } from './types/FileDiff';
import type { FileRef } from './types/FileRef';
import type { LocalChanges } from './types/LocalChanges';
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

  // Repository and S-06 (F-15, F-16).
  /** The active repository, or null until one is picked (M1: the default repository). */
  repoActive(): Promise<ActiveRepo | null>;
  /** Folder dialog; the picked repository becomes the default. Null when cancelled. */
  repoPick(): Promise<ActiveRepo | null>;
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
  /** Opens a repository file in Rider at a 1-based line (F-15.5). */
  riderOpen(file: string, line: number): Promise<void>;
  /** Calls `listener` when the working tree, index or HEAD changed (F-16.2). */
  onRepoChanged(listener: () => void): Promise<() => void>;

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
