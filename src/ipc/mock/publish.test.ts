import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import type { IpcClient } from '../client';
import type { GitlabScenario } from './gitlab';

// F-12.5: the mock backend's Publish follows the core's contract (`drafts_publish`, plan M5,
// decisions 8 and 9): the ticked drafts become published in one call, the answer lists what went
// out and what failed with a reason, a failed draft keeps its tick and shows the reason, and a
// second call with the failed ids publishes them without touching the published ones. Nothing is
// published without the call; GitLab must be connected like for every GitLab command.
//
// Mock knobs these tests rely on (GitlabScenario, set through MOCK_GITLAB_KEY in the browser):
// `publishFails` = 1-based places in the session's drafts whose FIRST publish fails with
// "the line is no longer in the MR"; `foreignDrafts` = draft comments already in GitLab's own
// review (decision 8), 0 after a Publish sent them.

const SESSION = 'mock-mr-session-1';
const LINE_GONE = 'the line is no longer in the MR';

async function backend(gitlab: GitlabScenario = {}, drafts = 5): Promise<IpcClient> {
  const mock = createMockClient({ latencyMs: 0, gitlab });
  await mock.repoPick();
  await mock.reviewPlan(SESSION, () => undefined);
  for (let n = 1; n <= drafts; n += 1) {
    await mock.draftsCreate({
      sessionId: SESSION,
      findingId: null,
      body: `Comment ${String(n)}`,
      position: {
        file: 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs',
        side: 'new',
        line: 40 + n,
      },
      severity: 'q',
    });
  }
  return mock;
}

const ids = async (mock: IpcClient) => (await mock.draftsList(SESSION)).map((d) => d.id);

describe('mock backend publish (F-12.5)', () => {
  it('F-12.5 a new draft is not outdated and not published', async () => {
    const mock = await backend({}, 1);
    const [draft] = await mock.draftsList(SESSION);
    expect(draft).toMatchObject({
      outdated: false,
      publishedNoteId: null,
      error: null,
      include: true,
    });
  });

  it('F-12.5 draftsPublish publishes the given drafts, keeps their tick and leaves the others alone', async () => {
    const mock = await backend();
    const all = await ids(mock);
    const chosen = [all[0] ?? '', all[1] ?? '', all[3] ?? ''];

    const outcome = await mock.draftsPublish(SESSION, chosen, null);

    expect(outcome.published).toEqual(chosen);
    expect(outcome.failed).toEqual([]);
    expect(outcome.summary).toBe(false);
    const after = await mock.draftsList(SESSION);
    for (const draft of after) {
      if (chosen.includes(draft.id)) {
        expect(draft.publishedNoteId).not.toBeNull();
        expect(draft).toMatchObject({ include: true, error: null });
      } else {
        expect(draft).toMatchObject({ publishedNoteId: null, include: true });
      }
    }
  });

  it('F-12.5 the summary text goes out in the same call and is reported', async () => {
    const mock = await backend();
    const all = await ids(mock);
    const outcome = await mock.draftsPublish(SESSION, all, 'Thanks, the queue looks good.');
    expect(outcome.published).toEqual(all);
    expect(outcome.summary).toBe(true);
  });

  it('F-12.5 a published draft is not published again by a second call', async () => {
    const mock = await backend(undefined, 2);
    const all = await ids(mock);
    await mock.draftsPublish(SESSION, all, null);
    const before = await mock.draftsList(SESSION);

    const again = await mock.draftsPublish(SESSION, all, null);

    expect(again.published).toEqual([]);
    expect(again.failed).toEqual([]);
    expect(await mock.draftsList(SESSION)).toEqual(before);
  });

  it('F-12.5 a draft that fails keeps its tick and its reason, the rest is published, and a retry publishes only it', async () => {
    const mock = await backend({ publishFails: [2, 4] });
    const all = await ids(mock);

    const first = await mock.draftsPublish(SESSION, all, null);

    expect(first.published).toEqual([all[0], all[2], all[4]]);
    expect(first.failed).toEqual([
      { id: all[1], reason: LINE_GONE },
      { id: all[3], reason: LINE_GONE },
    ]);
    const mid = await mock.draftsList(SESSION);
    expect(mid[1]).toMatchObject({ include: true, publishedNoteId: null, error: LINE_GONE });
    expect(mid[3]).toMatchObject({ include: true, publishedNoteId: null, error: LINE_GONE });
    const noteIds = mid.map((d) => d.publishedNoteId);

    const retry = await mock.draftsPublish(SESSION, [all[1] ?? '', all[3] ?? ''], null);

    expect(retry.published).toEqual([all[1], all[3]]);
    expect(retry.failed).toEqual([]);
    const done = await mock.draftsList(SESSION);
    expect(done.every((d) => d.publishedNoteId !== null && d.error === null)).toBe(true);
    // The drafts of the first call keep the notes they got.
    for (const index of [0, 2, 4]) expect(done[index]?.publishedNoteId).toBe(noteIds[index]);
  });

  it('F-12.5 a draft that is not in the session is refused', async () => {
    const mock = await backend(undefined, 1);
    await expect(mock.draftsPublish(SESSION, ['no-such-draft'], null)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'This draft no longer exists.',
    });
  });

  it('F-12.5 without a GitLab token nothing is published', async () => {
    const mock = await backend({ state: 'noToken' }, 2);
    const all = await ids(mock);
    await expect(mock.draftsPublish(SESSION, all, null)).rejects.toMatchObject({
      code: 'GITLAB_UNAUTHORIZED',
    });
    const after = await mock.draftsList(SESSION);
    expect(after.every((d) => d.publishedNoteId === null)).toBe(true);
    await expect(mock.gitlabForeignDrafts(SESSION)).rejects.toMatchObject({
      code: 'GITLAB_UNAUTHORIZED',
    });
  });

  it('F-12.5 the draft comments in GitLab’s own review are counted, and a Publish sends them too', async () => {
    const none = await backend({}, 1);
    await expect(none.gitlabForeignDrafts(SESSION)).resolves.toBe(0);

    const mock = await backend({ foreignDrafts: 2 }, 1);
    await expect(mock.gitlabForeignDrafts(SESSION)).resolves.toBe(2);
    await mock.draftsPublish(SESSION, await ids(mock), null);
    await expect(mock.gitlabForeignDrafts(SESSION)).resolves.toBe(0);
  });
});
