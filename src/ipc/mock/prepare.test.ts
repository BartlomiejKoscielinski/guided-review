import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import type { PrepareProgress } from '../types/PrepareProgress';

const client = () => createMockClient({ latencyMs: 0 });

describe('mock MR preparation (F-05.1, F-05.6, F-01.5)', () => {
  it('F-05.6 reports the stages in order and opens S-02', async () => {
    const ipc = client();
    const seen: PrepareProgress[] = [];
    const opened = await ipc.sessionOpenMr(482, null, 't1', (p) => seen.push(p));
    expect(opened.route).toEqual({ screen: 'S-02', sessionId: opened.sessionId });
    expect(seen.map((p) => p.stage)).toEqual([
      'fetching',
      'creatingWorktree',
      'computingDiff',
      'computingDiff',
    ]);
    expect(seen[0]).toMatchObject({ iid: 482 });
    expect(seen[3]).toMatchObject({ files: expect.any(Number) as number });
  });

  it('F-05.6 cancel rejects the running preparation', async () => {
    const ipc = client();
    const running = ipc.sessionOpenMr(482, null, 't2', (p) => {
      if (p.stage === 'creatingWorktree') void ipc.sessionPrepareCancel('t2');
    });
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('F-01.5 an unknown MR or project gives the inline copy', async () => {
    const ipc = client();
    await expect(ipc.sessionOpenMr(999, null, 't3', () => undefined)).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
      message: 'No merge request !999 in mobile/mobile-app',
    });
    await expect(ipc.sessionOpenMr(482, 'mobile/x', 't4', () => undefined)).rejects.toMatchObject({
      message: 'mobile/x is not one of your repositories. Add it in Settings › GitLab.',
    });
  });
});
