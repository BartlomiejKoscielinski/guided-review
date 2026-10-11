import type { IpcClient } from '../client';
import { health } from './fixtures/app';

export interface MockOptions {
  /** Fake latency per call, so loading states are visible in `npm run dev:mock`. */
  latencyMs?: number;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** IPC client with fixture data from the design mocks (ADR-016). */
export function createMockClient({ latencyMs = 120 }: MockOptions = {}): IpcClient {
  const respond = async <T>(value: T): Promise<T> => {
    if (latencyMs > 0) await wait(latencyMs);
    return structuredClone(value);
  };
  return {
    appHealth: () => respond(health),
  };
}
