import type { IpcClient } from '../client';
import { applySettingsPatch } from '../settings-patch';
import type { Settings } from '../types/Settings';
import type { UnfinishedSession } from '../types/UnfinishedSession';
import { health } from './fixtures/app';
import defaultSettings from './fixtures/default-settings.json';
import { unfinishedSessions } from './fixtures/sessions';
import { restoreRoute } from './route-restore';

/** Key under which the mock keeps its settings between page loads. */
export const MOCK_SETTINGS_KEY = 'guided-review.mock.settings';

export interface MockOptions {
  /** Fake latency per call, so loading states are visible in `npm run dev:mock`. */
  latencyMs?: number;
  /**
   * Where settings survive a reload (the browser's localStorage in `npm run dev:mock` and e2e);
   * without it they live only as long as the client.
   */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Unfinished sessions to report; none by default (no sessions exist before M3). */
  sessions?: UnfinishedSession[];
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The core's defaults (kept identical by a Rust test). */
export const DEFAULT_SETTINGS = defaultSettings as Settings;

function loadSettings(storage: MockOptions['storage']): Settings {
  const saved = storage?.getItem(MOCK_SETTINGS_KEY);
  if (!saved) return structuredClone(DEFAULT_SETTINGS);
  try {
    return { ...structuredClone(DEFAULT_SETTINGS), ...(JSON.parse(saved) as Partial<Settings>) };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

/** IPC client with fixture data from the design mocks (ADR-016). */
export function createMockClient({
  latencyMs = 120,
  storage = null,
  sessions = unfinishedSessions,
}: MockOptions = {}): IpcClient {
  let settings = loadSettings(storage);
  const respond = async <T>(value: T): Promise<T> => {
    if (latencyMs > 0) await wait(latencyMs);
    return structuredClone(value);
  };
  return {
    appHealth: () => respond(health),
    appSettingsGet: () => respond(settings),
    appSettingsSet: (patch) => {
      settings = applySettingsPatch(settings, patch);
      storage?.setItem(MOCK_SETTINGS_KEY, JSON.stringify(settings));
      return respond(settings);
    },
    appStartRoute: () =>
      respond(restoreRoute(settings.ui.lastRoute, (id) => sessions.some((s) => s.id === id))),
    sessionsListUnfinished: () => respond(sessions),
  };
}
