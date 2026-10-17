import type { Draft } from '../types/Draft';
import type { Finding } from '../types/Finding';
import type { Layout } from '../types/Layout';
import type { Mode } from '../types/Mode';
import type { MrRow } from '../types/MrRow';
import type { Source } from '../types/Source';
import type { Strategy } from '../types/Strategy';
import type { SummaryField } from '../types/SummaryField';
import type { Thread } from '../types/Thread';
import { MOCK_THREADS } from './fixtures/step';

/**
 * Key under which the mock keeps its review sessions between page loads, as the core keeps them
 * in SQLite (F-04.3): a new client on the same storage is the app started again.
 */
export const MOCK_SESSION_DATA_KEY = 'guided-review.mock.sessionData';

export type MockStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

/** S-02's plan of a session: the strategy, a dragged order, when the plan was cached. */
export interface SessionPlan {
  strategy: Strategy;
  custom: string[] | null;
  cachedAt: string | null;
}

/** What S-03 keeps of a session (the core's `sessions` and `steps_state` columns). */
export interface StoredState {
  currentStep: string | null;
  /** The layout the session was opened in or the last one chosen; null: `ui.focusLayout`. */
  layout: Layout | null;
  /** The mode the session was opened in or the last one toggled to; null: `ui.startIn`. */
  mode?: Mode | null;
  /** S-02 showed the session's plan (F-08.3); missing in data kept before it existed. */
  planOpened?: boolean;
  scroll: Record<string, number>;
  checklist: Record<string, string[]>;
  /** The files of each step marked reviewed on their own (F-07.10); missing in older data. */
  files?: Record<string, string[]>;
  /** When the session was opened (ISO 8601): the core's `updated_at` for its card (F-04.1). */
  openedAt?: string;
  /** S-05's "Add a summary comment" tick, text and suggested flag (F-12.4); missing: unticked. */
  summary?: SummaryField;
}

/** Everything the mock knows about review sessions. */
export interface SessionData {
  /** MR sessions opened from S-01 (the MR each one reviews) and how many were opened. */
  mrs: Record<string, MrRow>;
  mrCount: number;
  /** Commit and local sessions opened from S-01 and what each one reviews (F-17.1). */
  local: string[];
  localCount: number;
  sources: Record<string, Source>;
  /** Planned sessions; a session without a plan here has never been planned. */
  plans: Record<string, SessionPlan>;
  /** Steps marked reviewed, per session. */
  marks: Record<string, string[]>;
  /** `session\0step` of every analyzed step: Claude's cache of the step task. */
  analyzed: string[];
  /**
   * Notes by session and ID (`noteKey`) with their decisions and the session they belong to:
   * another session can hold a note with the same ID, with its own decision (F-09.4).
   */
  notes: Record<string, { finding: Finding; sessionId: string }>;
  drafts: Draft[];
  nextDraft: number;
  states: Record<string, StoredState>;
  /**
   * !482's threads as the mock GitLab has them now (F-11.2): Resolve, Reopen and Reply change
   * them, and every MR session of the mock shows them.
   */
  threads: Thread[];
}

export interface MockSessionData {
  readonly data: SessionData;
  /** Writes the data to the storage; call after every change. */
  save(): void;
}

const empty = (): SessionData => ({
  mrs: {},
  mrCount: 0,
  local: [],
  localCount: 0,
  sources: {},
  plans: {},
  marks: {},
  analyzed: [],
  notes: {},
  drafts: [],
  nextDraft: 1,
  states: {},
  threads: structuredClone(MOCK_THREADS),
});

function load(storage: MockStorage): SessionData {
  const saved = storage?.getItem(MOCK_SESSION_DATA_KEY);
  if (!saved) return empty();
  try {
    return { ...empty(), ...(JSON.parse(saved) as Partial<SessionData>) };
  } catch {
    return empty();
  }
}

/** The mock's review sessions: from the storage when it has them, else none. */
export function createSessionData(storage: MockStorage): MockSessionData {
  const data = load(storage);
  return {
    data,
    save: () => {
      storage?.setItem(MOCK_SESSION_DATA_KEY, JSON.stringify(data));
    },
  };
}

/** The session's stored state, created on first use. */
export function stateOf(data: SessionData, sessionId: string): StoredState {
  const state = (data.states[sessionId] ??= {
    currentStep: null,
    layout: null,
    mode: null,
    scroll: {},
    checklist: {},
  });
  return state;
}
