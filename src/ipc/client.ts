import type { SettingsPatch } from './settings-patch';
import type { AppHealth } from './types/AppHealth';
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
