import { describe, expect, it } from 'vitest';
import { createMockClient } from './index';
import { pipelineColumns } from './fixtures/pipeline';
import type { JobExplainEvent } from '../types/JobExplainEvent';

// F-20.7: the mock's `jobExplain` answers like `commands/job_explain.rs`: no account first, an
// unknown job GitLab's 404, a job that did not fail INVALID_INPUT; then preparing, reading, done
// with the design mock's EX table (Pipeline.dc.html).

const PROJECT = 'mobile/mobile-app';
const jobId = (pipeline: number, name: string): number => {
  const row = (pipelineColumns(pipeline) ?? []).flatMap((c) => c.jobs).find((j) => j.name === name);
  if (!row) throw new Error(`${name} not in ${String(pipeline)}`);
  return row.id;
};

describe('mock jobExplain (F-20.7)', () => {
  it('F-20.7 the mock explains ui-tests:android of #18342 as caused by this MR with a comment', async () => {
    const mock = createMockClient({ latencyMs: 0 });
    await mock.repoPick();
    const events: JobExplainEvent['kind'][] = [];
    const result = await mock.jobExplain(PROJECT, 482, jobId(18342, 'ui-tests:android'), (e) =>
      events.push(e.kind),
    );
    expect(events).toEqual(['preparing', 'reading', 'done']);
    expect(result.verdict).toBe('causedByMr');
    // The worktree is at the latest head now: a second run only reads (decision 12).
    events.length = 0;
    await mock.jobExplain(PROJECT, 482, jobId(18342, 'ui-tests:android'), (e) =>
      events.push(e.kind),
    );
    expect(events).toEqual(['reading', 'done']);
    expect(result.evidence).toEqual(['DeliveryPhotoPage.xaml:14', 'DeliveryPhotoPageTests.cs:41']);
    expect(result.suggestedComment).not.toBe('');
  });

  it('F-20.7 the mock explains unit-tests of #18321 as already fixed in version 3', async () => {
    const mock = createMockClient({ latencyMs: 0 });
    await mock.repoPick();
    const result = await mock.jobExplain(PROJECT, 482, jobId(18321, 'unit-tests'), () => undefined);
    expect(result).toMatchObject({
      verdict: 'alreadyFixed',
      fixedInVersion: 3,
      suggestedComment: '',
    });
  });

  it('F-20.7 the mock refuses a passed job and an unknown one, and starts nothing', async () => {
    const mock = createMockClient({ latencyMs: 0 });
    await mock.repoPick();
    const events: string[] = [];
    await expect(
      mock.jobExplain(PROJECT, 482, jobId(18342, 'restore'), (e) => events.push(e.kind)),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Only a failed job can be explained.',
    });
    await expect(mock.jobExplain(PROJECT, 482, 42, () => undefined)).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
    });
    expect(events).toEqual([]);
  });
});
