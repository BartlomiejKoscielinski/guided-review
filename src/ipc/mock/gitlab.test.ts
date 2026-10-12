import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

const client = (state?: 'connected' | 'noToken' | 'failing') =>
  createMockClient({ latencyMs: 0, gitlab: state ? { state } : {} });

describe('mock GitLab backend', () => {
  it('F-02.1 lists the three tabs of Start.dc.html with their counts', async () => {
    const mock = client();
    const waiting = await mock.gitlabListMrs('waiting');
    expect(waiting.rows.map((r) => r.iid)).toEqual([482, 479, 475]);
    expect(waiting.counts).toEqual({ waiting: 3, mine: 1, all: 12 });
    const mine = await mock.gitlabListMrs('mine');
    expect(mine.rows.map((r) => r.iid)).toEqual([480]);
    expect(mine.rows[0]?.mine).toBe(true);
    const all = await mock.gitlabListMrs('all');
    expect(all.rows.map((r) => r.iid)).toEqual([482, 481, 480]);
  });

  it('F-02.2 rows carry stats, pipeline and the note line', async () => {
    const [offline, , large] = (await client().gitlabListMrs('waiting')).rows;
    expect(offline).toMatchObject({
      additions: 462,
      deletions: 61,
      files: 16,
      pipeline: 'passed',
      note: 'You’re a reviewer · plan is ready',
    });
    expect(large).toMatchObject({
      files: 61,
      pipeline: 'failed',
      note: 'Large: the plan splits it by layer',
    });
    const [mine] = (await client().gitlabListMrs('mine')).rows;
    expect(mine?.note).toBe('2 unresolved threads from reviewers');
  });

  it('F-19.5 check and save returns only the masked token; remove clears it', async () => {
    const mock = client('noToken');
    expect((await mock.gitlabStatus(false)).state).toBe('noToken');
    await expect(mock.gitlabListMrs('all')).rejects.toMatchObject({ code: 'GITLAB_UNAUTHORIZED' });
    const token = 'glpat-mocktoken3f9a';
    const saved = await mock.gitlabAccountSave('https://gitlab.local/ ', token);
    expect(saved).toMatchObject({
      state: 'connected',
      server: 'https://gitlab.local',
      tokenMasked: 'glpat-…3f9a',
    });
    expect(JSON.stringify(saved)).not.toContain(token);
    await expect(mock.gitlabAccountSave('https://gitlab.local', '  ')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    const removed = await mock.gitlabAccountRemove();
    expect(removed).toMatchObject({
      state: 'noToken',
      server: 'https://gitlab.local',
      tokenMasked: null,
    });
  });

  it('F-01.6 reports a failing token with the reason', async () => {
    const status = await client('failing').gitlabStatus(true);
    expect(status.state).toBe('failing');
    expect(status.problem?.code).toBe('GITLAB_UNAUTHORIZED');
    expect((await client().gitlabStatus(false)).user?.username).toBe('bartek.k');
  });
});
