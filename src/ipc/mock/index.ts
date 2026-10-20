import type { IpcClient } from '../client';
import { applySettingsPatch, type SettingsPatch } from '../settings-patch';
import { createStepRuns } from './analysisStatus';
import { createChangesBackend, type ChangesScenario } from './changes';
import { createClaudeBackend, type ClaudeScenario } from './claude';
import { createFixBackend } from './fix';
import { createGitlabBackend, type GitlabScenario } from './gitlab';
import { createMockRepos } from './repos';
import { createPrepareBackend } from './prepare';
import { createPlanBackend } from './plan';
import { createReviewBackend, type ReviewScenario } from './review';
import { createRiderBackend, type RiderScenario } from './rider';
import { createSessionData } from './session-data';
import { createSourcesBackend, mockSessionSource } from './sources';
import { createStateBackend } from './state';
import type { Settings } from '../types/Settings';
import type { UnfinishedSession } from '../types/UnfinishedSession';
import { health } from './fixtures/app';
import defaultSettings from './fixtures/default-settings.json';
import { unfinishedSessions } from './fixtures/sessions';
import { restoreRoute } from './route-restore';
import { openedSessions } from './unfinished';
import { createMrDraftsBackend, moveMrDrafts } from './mrDrafts';
import { BRANCH } from './fixtures/changes';

export { MOCK_SESSION_DATA_KEY } from './session-data';

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
/** Key with a `ReviewScenario` (S-02 plan and S-03 step task failures, cached plan). */
export const MOCK_REVIEW_KEY = 'guided-review.mock.review';

export interface MockOptions {
  /** Fake latency per call, so loading states are visible in `npm run dev:mock`. */
  latencyMs?: number;
  /**
   * Where settings and review sessions survive a reload (the browser's localStorage in
   * `npm run dev:mock` and e2e); without it they live only as long as the client.
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
  /** Rider variations (F-24.4). */
  rider?: RiderScenario;
  /** S-03 variations; the storage's `MOCK_REVIEW_KEY` wins. */
  review?: ReviewScenario;
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
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return structuredClone(DEFAULT_SETTINGS);
    }
    // Merged like a patch, so settings saved before a key existed get its default.
    return applySettingsPatch(DEFAULT_SETTINGS, parsed);
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
  rider: riderOption = {},
  review: reviewOption = {},
}: MockOptions = {}): IpcClient {
  let settings = loadSettings(storage);
  const sessions = loadSessions(storage, sessionsOption);
  const changes = loadJson(storage, MOCK_CHANGES_KEY, changesOption);
  const repos = createMockRepos(changes.noRepo ?? false);
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
  const setSettings = (patch: SettingsPatch): Settings => {
    settings = applySettingsPatch(settings, patch);
    storage?.setItem(MOCK_SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  };
  // Review sessions survive a reload like the core's SQLite (F-04.3).
  const data = createSessionData(storage);
  const focusLayout = () => settings.ui.focusLayout;
  const startIn = () => settings.ui.startIn;
  const sessionExists = (id: string) =>
    sessions.some((s) => s.id === id) ||
    id in data.data.mrs ||
    data.data.local.includes(id) ||
    data.data.draftsOnly.includes(id);
  const sourceOf = (id: string) => mockSessionSource(data.data, repos, id);
  const pause = (ms: number) => (latencyMs > 0 ? wait(ms) : Promise.resolve());
  const reviewScenario = loadJson(storage, MOCK_REVIEW_KEY, reviewOption);
  const runs = createStepRuns();
  const gitlab = createGitlabBackend(
    loadJson(storage, MOCK_GITLAB_KEY, gitlabOption),
    respond,
    data,
  );
  const claude = createClaudeBackend(
    loadJson(storage, MOCK_CLAUDE_KEY, claudeOption),
    respond,
    pause,
    (sessionId) => data.data.plans[sessionId] !== undefined,
    (sessionId) => gitlab.gitlabDiscussions(sessionId),
  );
  const fix = createFixBackend(data, sourceOf);
  return {
    appHealth: () => respond(health),
    appSettingsGet: () => respond(settings),
    appSettingsSet: (patch) => respond(setSettings(patch)),
    appStartRoute: () => respond(restoreRoute(settings.ui.lastRoute, sessionExists)),
    // Sessions opened in this mock come first, as the core lists them; then the seeded ones.
    sessionsListUnfinished: () =>
      respond([
        ...openedSessions(data.data, {
          startIn: startIn(),
          lastRoute: settings.ui.lastRoute,
          sourceOf,
          branch: BRANCH,
        }),
        ...sessions,
      ]),
    ...createChangesBackend(changes, respond, repos),
    ...createSourcesBackend(respond, repos, data, focusLayout, startIn),
    ...createPrepareBackend(repos, pause, data, focusLayout, startIn, (sessionId, mr) => {
      moveMrDrafts(data.data, sourceOf, mr, sessionId);
    }),
    ...createMrDraftsBackend(respond, data, sourceOf),
    ...claude,
    // F-25.3: a fix run ends on `claudeCancel(task)` like the other Claude tasks.
    fixPropose: fix.fixPropose,
    claudeCancel: (task) => {
      fix.cancel(task);
      return claude.claudeCancel(task);
    },
    ...gitlab,
    ...createReviewBackend(reviewScenario, respond, pause, data, runs),
    ...createPlanBackend(reviewScenario, respond, pause, data, runs),
    ...createStateBackend(respond, data, focusLayout, startIn),
    ...createRiderBackend(riderOption, respond, (path) => setSettings({ rider: { path } })),
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
