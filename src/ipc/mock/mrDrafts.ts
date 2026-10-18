import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { Draft } from '../types/Draft';
import type { SessionStatus } from '../types/SessionStatus';
import type { Source } from '../types/Source';
import { stateOf, type MockSessionData, type SessionData } from './session-data';

type MrDraftsClient = Pick<IpcClient, 'draftsCreateForMr' | 'sessionStatus'>;

/** The source of a mock session as `sessionSource` reports it. */
export type SourceOf = (sessionId: string) => Source | undefined;

const DRAFTS_ONLY_SESSION = 'mock-drafts-only-';

/** A session stores the MR it reviews; GitLab project paths ignore case (`store::mr_sessions`). */
const reviews = (source: Source | undefined, project: string, iid: number): boolean =>
  source?.kind === 'mr' &&
  source.iid === iid &&
  source.project.toLowerCase() === project.toLowerCase();

const usedAt = (data: SessionData, id: string): string =>
  data.states[id]?.openedAt ?? new Date(0).toISOString();

/**
 * The MR's sessions, the one used last first (the core's `store::mr_sessions`). Of two saved in the
 * same instant the review wins: the mock makes a drafts-only session only while the MR has no
 * review session, so a review opened in that instant is the later one.
 */
function sessionsOfMr(data: SessionData, sourceOf: SourceOf, project: string, iid: number) {
  const ids = [...data.draftsOnly, ...Object.keys(data.mrs)];
  return ids
    .filter((id) => reviews(sourceOf(id), project, iid))
    .reverse()
    .sort((a, b) => usedAt(data, b).localeCompare(usedAt(data, a)));
}

/**
 * Moves the unpublished drafts of the MR's other sessions into `sessionId`, a review of the MR just
 * opened (F-12.7, M5 decision 15): the same drafts with the new session; published ones stay.
 */
export function moveMrDrafts(
  data: SessionData,
  sourceOf: SourceOf,
  mr: { project: string; iid: number },
  sessionId: string,
): void {
  const others = new Set(
    sessionsOfMr(data, sourceOf, mr.project, mr.iid).filter((id) => id !== sessionId),
  );
  data.drafts = data.drafts.map((d) =>
    others.has(d.sessionId) && d.publishedNoteId === null ? { ...d, sessionId } : d,
  );
}

/** A new "drafts only" session of the MR: no plan and no steps; S-05 opens it. */
function createDraftsOnly(data: SessionData, project: string, iid: number): string {
  const sessionId = `${DRAFTS_ONLY_SESSION}${String(data.draftsOnly.length + 1)}`;
  data.draftsOnly = [...data.draftsOnly, sessionId];
  data.sources[sessionId] = { kind: 'mr', project, iid };
  stateOf(data, sessionId).openedAt = new Date().toISOString();
  return sessionId;
}

/**
 * Drafts made outside a review (F-12.7): Explain failure on S-08 and Add as a question on S-12
 * name the MR, and the draft joins the MR's session used last (the mock has no done sessions),
 * else a new drafts-only one, as the core's `drafts::attach_to_mr`.
 */
export function createMrDraftsBackend(
  respond: <T>(value: T) => Promise<T>,
  store: MockSessionData,
  sourceOf: SourceOf,
): MrDraftsClient {
  const { data } = store;
  return {
    // The core's `session_status`: a session the mock knows is drafts-only, else planning until S-02
    // showed its plan, then reviewing (as `sessionsListUnfinished` lists it).
    sessionStatus: (sessionId) => {
      if (!sourceOf(sessionId)) {
        return Promise.reject(
          new IpcError({ code: 'INVALID_INPUT', message: 'Unknown session.', retryable: false }),
        );
      }
      const status: SessionStatus = data.draftsOnly.includes(sessionId)
        ? 'draftsOnly'
        : data.plans[sessionId]
          ? 'reviewing'
          : 'planning';
      return respond(status);
    },
    draftsCreateForMr: (project, iid, draft) => {
      if (draft.body.trim() === '') {
        return Promise.reject(
          new IpcError({
            code: 'INVALID_INPUT',
            message: 'Write a comment first.',
            retryable: false,
          }),
        );
      }
      const sessionId =
        sessionsOfMr(data, sourceOf, project, iid)[0] ?? createDraftsOnly(data, project, iid);
      const created: Draft = {
        id: `mock-draft-${String(data.nextDraft++)}`,
        sessionId,
        findingId: null,
        body: draft.body,
        position: draft.position,
        severity: draft.severity,
        include: true,
        publishedNoteId: null,
        error: null,
        stepId: null,
        outdated: false,
      };
      data.drafts = [...data.drafts, created];
      store.save();
      return respond(created);
    },
  };
}
