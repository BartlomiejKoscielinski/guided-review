import { invoke, type InvokeArgs } from '@tauri-apps/api/core';
import type { IpcClient } from './client';
import { toIpcError } from './errors';
import type { AppHealth } from './types/AppHealth';

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
  };
}
