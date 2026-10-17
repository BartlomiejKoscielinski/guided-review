import { describe, expect, it } from 'vitest';
import { createMockClient } from './index';

// F-12.5: the mock backend keeps, like the core, that a session's summary comment was published:
// `sessionSummary` reports it, a later Publish doesn't send it again, and the field the UI writes
// doesn't clear it.

const SESSION = 'mock-mr-session-1';
const SUMMARY = 'Thanks, the queue looks good.';

describe('mock draftsPublish and the summary comment (F-12.5)', () => {
  it('F-12.5 a published summary is kept as published and not sent again', async () => {
    const mock = createMockClient({ latencyMs: 0 });
    await mock.repoPick();
    await mock.sessionSetSummary(SESSION, { enabled: true, text: SUMMARY, suggested: false });
    expect((await mock.sessionSummary(SESSION)).published).toBeUndefined();

    const first = await mock.draftsPublish(SESSION, [], SUMMARY);
    expect(first.summary).toBe(true);
    expect((await mock.sessionSummary(SESSION)).published).toBe(true);

    await mock.sessionSetSummary(SESSION, { enabled: true, text: 'Edited.', suggested: false });
    const kept = await mock.sessionSummary(SESSION);
    expect(kept).toEqual({ enabled: true, text: 'Edited.', suggested: false, published: true });
    const again = await mock.draftsPublish(SESSION, [], 'Edited.');
    expect(again.summary).toBe(false);
  });
});
