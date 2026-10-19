import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import type { IpcClient } from '../client';
import type { GitlabScenario } from './gitlab';

// F-12.5, M5 decision 10b: the MR has a new version since the review (`mrChanged`), and the lines
// of the drafts at the 1-based places `linesGone` are gone from it. Like the core's re-map, Publish
// holds those back (failed "the line is no longer in the MR", outdated, unticked) and sends the
// others; an outdated draft ticked again goes out (as a general comment in the core).

const SESSION = 'mock-mr-session-1';
const LINE_GONE = 'the line is no longer in the MR';

async function backend(gitlab: GitlabScenario): Promise<IpcClient> {
  const mock = createMockClient({ latencyMs: 0, gitlab });
  await mock.repoPick();
  await mock.reviewPlan(SESSION, () => undefined);
  for (let n = 1; n <= 3; n += 1) {
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

describe('mock backend publish on a new MR version (F-12.5, decision 10b)', () => {
  it('F-12.5 a draft whose line is gone is held back, outdated and unticked; the rest go out', async () => {
    const mock = await backend({ mrChanged: true, linesGone: [2] });
    const ids = (await mock.draftsList(SESSION)).map((d) => d.id);

    const outcome = await mock.draftsPublish(SESSION, ids, null);

    expect(outcome.published).toEqual([ids[0], ids[2]]);
    expect(outcome.failed).toEqual([{ id: ids[1], reason: LINE_GONE }]);
    const gone = (await mock.draftsList(SESSION))[1];
    expect(gone).toMatchObject({
      outdated: true,
      include: false,
      error: LINE_GONE,
      publishedNoteId: null,
    });
  });

  it('F-12.5 an outdated draft ticked again is published', async () => {
    const mock = await backend({ mrChanged: true, linesGone: [2] });
    const ids = (await mock.draftsList(SESSION)).map((d) => d.id);
    await mock.draftsPublish(SESSION, ids, null);

    const again = await mock.draftsPublish(SESSION, [ids[1] ?? ''], null);

    expect(again).toMatchObject({ published: [ids[1]], failed: [] });
  });

  it('F-12.5 without a new MR version every line stays', async () => {
    const mock = await backend({ linesGone: [2] });
    const ids = (await mock.draftsList(SESSION)).map((d) => d.id);

    const outcome = await mock.draftsPublish(SESSION, ids, null);

    expect(outcome.published).toEqual(ids);
    expect((await mock.draftsList(SESSION)).some((d) => d.outdated)).toBe(false);
  });
});
