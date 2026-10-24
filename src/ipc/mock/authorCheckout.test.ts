import { describe, expect, it } from 'vitest';
import { createMockClient, MOCK_AUTHOR_KEY } from '.';

// F-26.8 in the mock backend, as the core answers `author_mr(project, iid)`: `onSourceBranch` says
// whether the checkout is on the MR's source branch. The mock's !480 is editable (true) so the
// fix flow of F-26.2 to F-26.7 stays visible in `npm run dev:mock`; the scenario knob
// `{ "onSourceBranch": false }` (the option `author`, or the storage key MOCK_AUTHOR_KEY =
// 'guided-review.mock.author', which wins) shows the read-only state to the e2e tests.

const PROJECT = 'mobile/mobile-app';
const MINE = 480;

type Storage = NonNullable<Parameters<typeof createMockClient>[0]>['storage'];

const stored = (value: unknown): Storage => ({
  getItem: (key) => (key === MOCK_AUTHOR_KEY ? JSON.stringify(value) : null),
  setItem: () => undefined,
});

async function mrOf(options: Parameters<typeof createMockClient>[0] = {}) {
  const mock = createMockClient({ latencyMs: 0, ...options });
  await mock.repoPick();
  return mock.authorMr(PROJECT, MINE);
}

describe('mock author_mr checkout state (F-26.8)', () => {
  it('F-26.8 the key of the author scenario is guided-review.mock.author', () => {
    expect(MOCK_AUTHOR_KEY).toBe('guided-review.mock.author');
  });

  it('F-26.8 !480 is on its source branch by default', async () => {
    const mr = await mrOf();

    expect(mr.sourceBranch).toBe('feature/upload-retry');
    expect(mr.onSourceBranch).toBe(true);
  });

  it('F-26.8 the author option puts the checkout on another branch', async () => {
    const mr = await mrOf({ author: { onSourceBranch: false } });

    expect(mr.onSourceBranch).toBe(false);
    expect(mr.threads.length).toBeGreaterThan(0);
  });

  it('F-26.8 the stored scenario wins over the option', async () => {
    const mr = await mrOf({
      author: { onSourceBranch: true },
      storage: stored({ onSourceBranch: false }),
    });

    expect(mr.onSourceBranch).toBe(false);
  });
});
