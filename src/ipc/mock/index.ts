import type { IpcClient } from '../client';
import { applySettingsPatch } from '../settings-patch';
import { createChangesBackend, type ChangesScenario } from './changes';
import { createClaudeBackend, type ClaudeScenario } from './claude';
import { createGitlabBackend, type GitlabScenario } from './gitlab';
import type { Settings } from '../types/Settings';
import type { UnfinishedSession } from '../types/UnfinishedSession';
import { health } from './fixtures/app';
import defaultSettings from './fixtures/default-settings.json';
import { unfinishedSessions } from './fixtures/sessions';
import { restoreRoute } from './route-restore';

/** Key under which the mock keeps its settings between page loads. */
export const MOCK_SETTINGS_KEY = 'guided-review.mock.settings';
/** Key with unfinished sessions to report instead of the fixture (e2e and design shots). */
export const MOCK_SESSIONS_KEY = 'guided-review.mock.sessions';
/** Key with a `ChangesScenario` for S-06 (e2e and design shots). */
export const MOCK_CHANGES_KEY = 'guided-review.mock.changes';
/** Key with a `ClaudeScenario` (Claude status and Suggest failures). */
export const MOCK_CLAUDE_KEY = 'guided-review.mock.claude';
/** Key with a `GitlabScenario` (connected, no token, failing). */
export const MOCK_GITLAB_KEY = 'guided-review.mock.gitlab';

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
  /** S-06 variations; the storage's `MOCK_CHANGES_KEY` wins. */
  changes?: ChangesScenario;
  /** Claude variations; the storage's `MOCK_CLAUDE_KEY` wins. */
  claude?: ClaudeScenario;
  /** GitLab variations; the storage's `MOCK_GITLAB_KEY` wins. */
  gitlab?: GitlabScenario;
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

function loadJson<T>(storage: MockOptions['storage'], key: string, fallback: T): T {
  const saved = storage?.getItem(key);
  if (!saved) return fallback;
  try {
    return JSON.parse(saved) as T;
  } catch {
    return fallback;
  }
}

function loadSessions(
  storage: MockOptions['storage'],
  fallback: UnfinishedSession[],
): UnfinishedSession[] {
  const saved = storage?.getItem(MOCK_SESSIONS_KEY);
  if (!saved) return fallback;
  try {
    return JSON.parse(saved) as UnfinishedSession[];
  } catch {
    return fallback;
  }
}

/** IPC client with fixture data from the design mocks (ADR-016). */
export function createMockClient({
  latencyMs = 120,
  storage = null,
  sessions: sessionsOption = unfinishedSessions,
  changes: changesOption = {},
  claude: claudeOption = {},
  gitlab: gitlabOption = {},
}: MockOptions = {}): IpcClient {
  let settings = loadSettings(storage);
  const sessions = loadSessions(storage, sessionsOption);
  let maximized = false;
  const maximizedListeners = new Set<(maximized: boolean) => void>();
  const setMaximized = (value: boolean) => {
    maximized = value;
    for (const listener of maximizedListeners) listener(value);
  };
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
    ...createChangesBackend(loadJson(storage, MOCK_CHANGES_KEY, changesOption), respond),
    ...createClaudeBackend(loadJson(storage, MOCK_CLAUDE_KEY, claudeOption), respond, (ms) =>
      latencyMs > 0 ? wait(ms) : Promise.resolve(),
    ),
    ...createGitlabBackend(loadJson(storage, MOCK_GITLAB_KEY, gitlabOption), respond),
    // The browser has no window to move; the mock only tracks the maximized state.
    windowMinimize: () => Promise.resolve(),
    windowToggleMaximize: () => {
      setMaximized(!maximized);
      return Promise.resolve();
    },
    windowClose: () => Promise.resolve(),
    windowStartDragging: () => Promise.resolve(),
    windowIsMaximized: () => Promise.resolve(maximized),
    onWindowMaximizedChange: (listener) => {
      maximizedListeners.add(listener);
      return Promise.resolve(() => {
        maximizedListeners.delete(listener);
      });
    },
  };
}
