import type { RenderResult } from '@testing-library/react';
import { App } from '../app/App';
import { createAppRouter } from '../app/router';
import type { IpcClient } from '../ipc/client';
import type { Route } from '../ipc/types/Route';
import { renderWithIpc } from './render';

export interface RenderedApp extends RenderResult {
  router: ReturnType<typeof createAppRouter>;
}

/** Renders the whole app (shell + screens) on `start` with the mock backend. */
export function renderApp(
  start: Route = { screen: 'S-01' },
  client: Partial<IpcClient> = {},
): RenderedApp {
  const router = createAppRouter(start);
  return { router, ...renderWithIpc(<App router={router} />, client) };
}

/** An IPC client that records which commands were called. */
export function recordingClient(base: IpcClient): { client: IpcClient; calls: string[] } {
  const calls: string[] = [];
  const client = new Proxy(base, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string') return value;
      return (...args: unknown[]) => {
        calls.push(property);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { client, calls };
}
