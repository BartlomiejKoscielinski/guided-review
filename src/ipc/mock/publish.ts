import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { Draft } from '../types/Draft';
import type { GitlabUser } from '../types/GitlabUser';
import type { PublishOutcome } from '../types/PublishOutcome';
import type { ApprovalScenario } from './approvals';
import { stateOf, type MockSessionData } from './session-data';

type PublishActions = Pick<IpcClient, 'draftsPublish' | 'gitlabForeignDrafts'>;

/** Decision 9's reason for a position GitLab refuses. */
export const LINE_GONE = 'the line is no longer in the MR';

/** The knobs of the mock GitLab Publish uses (part of `GitlabScenario`). */
export interface PublishScenario {
  /**
   * 1-based places in the session's drafts whose FIRST publish fails with "the line is no longer
   * in the MR" (decision 9); a Retry publishes them.
   */
  publishFails?: number[];
  /** Draft comments already in GitLab's own review (decision 8); 0 once a Publish sent them. */
  foreignDrafts?: number;
  /**
   * 1-based places in the session's drafts whose line is gone from the MR's new version
   * (`mrChanged`, decision 10b): Publish makes them outdated and unticked and sends nothing for
   * them; ticked again, they go out as general comments.
   */
  linesGone?: number[];
}

const invalid = (message: string) =>
  new IpcError({ code: 'INVALID_INPUT', message, retryable: false });

/**
 * Publish (N) and Retry (F-12.5) as `commands/publish.rs` answers, with the same guards in the
 * same order (a session without an MR, an unknown draft, no GitLab account): the asked drafts not
 * published yet go out in one batch with the summary comment, a failing one keeps its tick and
 * gets its reason, and a published draft or summary is never sent again.
 */
export function createPublishActions(
  store: MockSessionData,
  scenario: PublishScenario & Pick<ApprovalScenario, 'mrChanged'>,
  user: () => GitlabUser | null,
  unauthorized: () => IpcError,
  respond: <T>(value: T) => Promise<T>,
): PublishActions {
  const { data } = store;
  let foreign = scenario.foreignDrafts ?? 0;
  const failedOnce = new Set<string>();

  const publish = (sessionId: string, ids: string[], summary: string | null): PublishOutcome => {
    if (data.local.includes(sessionId)) throw invalid('The session has no merge request.');
    const mine = data.drafts.filter((d) => d.sessionId === sessionId);
    if (ids.some((id) => !mine.some((d) => d.id === id))) {
      throw invalid('This draft no longer exists.');
    }
    if (!user()) throw unauthorized();

    const outcome: PublishOutcome = { published: [], summary: false, failed: [] };
    const changed = new Map<string, Draft>();
    let nextNote = Math.max(9000, ...data.drafts.map((d) => d.publishedNoteId ?? 0)) + 1;
    for (const id of new Set(ids)) {
      const draft = mine.find((d) => d.id === id);
      if (!draft || draft.publishedNoteId !== null) continue;
      const place = mine.indexOf(draft) + 1;
      // Like the core's re-map to the MR's new version (decision 10b): a line comment whose line
      // is gone is held back, outdated and unticked; an outdated one goes out without its line.
      const gone = scenario.mrChanged === true && scenario.linesGone?.includes(place) === true;
      if (gone && draft.position !== null && !draft.outdated) {
        outcome.failed.push({ id, reason: LINE_GONE });
        changed.set(id, { ...draft, outdated: true, include: false, error: LINE_GONE });
      } else if (scenario.publishFails?.includes(place) && !failedOnce.has(id)) {
        failedOnce.add(id);
        outcome.failed.push({ id, reason: LINE_GONE });
        changed.set(id, { ...draft, error: LINE_GONE });
      } else {
        outcome.published.push(id);
        changed.set(id, { ...draft, publishedNoteId: nextNote++, error: null });
      }
    }
    // A summary already published is never sent again (F-12.5), like the core.
    const kept = data.states[sessionId]?.summary;
    outcome.summary = summary !== null && summary.trim() !== '' && kept?.published !== true;
    if (outcome.summary && summary !== null) {
      stateOf(data, sessionId).summary = {
        enabled: true,
        text: summary,
        suggested: false,
        ...kept,
        published: true,
      };
    }
    if (outcome.published.length > 0 || outcome.summary) foreign = 0;
    data.drafts = data.drafts.map((d) => changed.get(d.id) ?? d);
    return outcome;
  };

  return {
    draftsPublish: (sessionId, ids, summary) => {
      try {
        const outcome = publish(sessionId, ids, summary);
        store.save();
        return respond(outcome);
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    gitlabForeignDrafts: (sessionId) => {
      if (data.local.includes(sessionId)) {
        return Promise.reject(invalid('The session has no merge request.'));
      }
      if (!user()) return Promise.reject(unauthorized());
      return respond(foreign);
    },
  };
}
