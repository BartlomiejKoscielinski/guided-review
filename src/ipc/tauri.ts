import { invoke, type InvokeArgs } from '@tauri-apps/api/core';
import type { IpcClient } from './client';
import { toIpcError } from './errors';
import type { AppHealth } from './types/AppHealth';
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

/** IPC client backed by the Rust core (Tauri commands). */
export function createTauriClient(): IpcClient {
  return {
    appHealth: () => call<AppHealth>('app_health'),
    appSettingsGet: () => call<Settings>('app_settings_get'),
    appSettingsSet: (patch) => call<Settings>('app_settings_set', { patch }),
    appStartRoute: () => call<Route>('app_start_route'),
    sessionsListUnfinished: () => call<UnfinishedSession[]>('sessions_list_unfinished'),
  };
}
