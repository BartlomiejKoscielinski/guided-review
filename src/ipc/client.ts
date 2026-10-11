import type { AppHealth } from './types/AppHealth';

/**
 * The only way the UI talks to the core (docs/04-architecture.md › IPC contract).
 * Implemented by `tauri.ts` (the Rust core) and `mock/` (browser dev and e2e tests);
 * every command exists in both. Failures reject with an `IpcError`.
 */
export interface IpcClient {
  appHealth(): Promise<AppHealth>;
}

/** Picks the implementation: the mock backend in `npm run dev:mock`, the Rust core otherwise. */
export async function createIpcClient(): Promise<IpcClient> {
  if (import.meta.env.VITE_IPC === 'mock') {
    const { createMockClient } = await import('./mock');
    return createMockClient();
  }
  const { createTauriClient } = await import('./tauri');
  return createTauriClient();
}
