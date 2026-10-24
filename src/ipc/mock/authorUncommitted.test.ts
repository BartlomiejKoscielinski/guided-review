import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

// M7 decision 10 in the mock backend, as the core answers `author_uncommitted_files()`: the
// active checkout's uncommitted files. None by default, so S-10 in `npm run dev:mock` matches
// Author.dc.html (no warning); the author scenario's `uncommitted` lists some.

describe('mock author_uncommitted_files (F-26.8, M7 decision 10)', () => {
  it('F-26.8 the checkout of !480 has no uncommitted files by default', async () => {
    const mock = createMockClient({ latencyMs: 0 });
    await mock.repoPick();

    expect(await mock.authorUncommittedFiles()).toEqual([]);
  });

  it('F-26.8 the author scenario lists the uncommitted files', async () => {
    const mock = createMockClient({ latencyMs: 0, author: { uncommitted: ['README.md'] } });
    await mock.repoPick();

    expect(await mock.authorUncommittedFiles()).toEqual(['README.md']);
  });

  it('F-26.8 without an active repository it is INVALID_INPUT, as in the core', async () => {
    const mock = createMockClient({ latencyMs: 0, changes: { noRepo: true } });

    await expect(mock.authorUncommittedFiles()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Pick a repository first.',
    });
  });
});
