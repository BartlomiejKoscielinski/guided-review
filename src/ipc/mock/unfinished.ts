import type { Mode } from '../types/Mode';
import type { Route } from '../types/Route';
import type { SessionStatus } from '../types/SessionStatus';
import type { Source } from '../types/Source';
import type { UnfinishedSession } from '../types/UnfinishedSession';
import { plannedView } from './plan';
import { sessionMrRow } from './prepare';
import type { SessionData } from './session-data';

/** What the listing needs from the rest of the mock. */
export interface ListingContext {
  /** `ui.startIn`: the mode of a session that never stored one. */
  startIn: Mode;
  /** `ui.lastRoute`: a session's own last screen is where it resumes. */
  lastRoute: Route;
  /** The source of a session as `sessionSource` reports it. */
  sourceOf: (sessionId: string) => Source | undefined;
  /** A self-review's card title: the branch checked out in its repository. */
  branch: string;
}

/** The core's `review::sessions::card_title`. */
function cardTitle(source: Source, mrTitle: string | undefined, branch: string): string {
  const short = (sha: string) => sha.slice(0, 7);
  switch (source.kind) {
    case 'mr':
      return mrTitle ?? source.project;
    case 'local':
      return branch;
    case 'commits':
      return source.from ? `${short(source.from)}..${short(source.to)}` : short(source.to);
  }
}

/** The core's `review::sessions::resume_route`. */
function resumeRoute(id: string, status: SessionStatus, mode: Mode, lastRoute: Route): Route {
  // A drafts-only session has no steps: it always opens the summary (F-12.7).
  if (status === 'draftsOnly') return { screen: 'S-05', sessionId: id };
  if ('sessionId' in lastRoute && lastRoute.sessionId === id) return lastRoute;
  if (status === 'planning') return { screen: 'S-02', sessionId: id };
  return mode === 'detailed'
    ? { screen: 'S-04', sessionId: id }
    : { screen: 'S-03', sessionId: id };
}

/**
 * The sessions opened in the mock as the core lists them (F-04.1, F-30.2), most recently opened
 * first: a session is "planning" until S-02 showed its plan, then "reviewing". The mock has no
 * finish yet, so every opened session is unfinished. A "drafts only" session is listed while it
 * holds an unpublished draft (F-12.7, M5 decision 15).
 */
export function openedSessions(data: SessionData, cx: ListingContext): UnfinishedSession[] {
  const ids = [...Object.keys(data.mrs), ...data.local, ...data.draftsOnly];
  const listed = ids.flatMap((id): UnfinishedSession[] => {
    const source = cx.sourceOf(id);
    if (!source) return [];
    const state = data.states[id];
    const planned = data.plans[id];
    const drafts = data.drafts.filter((d) => d.sessionId === id && d.publishedNoteId === null);
    const draftsOnly = data.draftsOnly.includes(id);
    if (draftsOnly && drafts.length === 0) return [];
    const status: SessionStatus = draftsOnly ? 'draftsOnly' : planned ? 'reviewing' : 'planning';
    const mode = state?.mode ?? cx.startIn;
    const plan = planned && !draftsOnly ? plannedView(data, id, planned) : null;
    return [
      {
        id,
        status,
        mode,
        updatedAt: state?.openedAt ?? new Date(0).toISOString(),
        resume: resumeRoute(id, status, mode, cx.lastRoute),
        source,
        title: cardTitle(source, sessionMrRow(data, id)?.title, cx.branch),
        reviewedSteps: plan?.reviewed.length ?? 0,
        totalSteps: plan?.order.order.length ?? 0,
        drafts: drafts.length,
      },
    ];
  });
  return listed.reverse().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
