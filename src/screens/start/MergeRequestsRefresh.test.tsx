import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { IpcError } from '../../ipc/errors';
import type { IpcClient } from '../../ipc/client';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

const MINUTE = 60_000;

const column = () => within(screen.getByRole('region', { name: 'Merge requests' }));

/** The mock's list call, counted; later calls fail when `failAfterFirst`. */
function countedList(failAfterFirst = false) {
  const ipc = mockClient();
  let calls = 0;
  const gitlabListMrs = vi.fn<IpcClient['gitlabListMrs']>((tab) => {
    calls += 1;
    if (failAfterFirst && calls > 1) {
      return Promise.reject(
        new IpcError({
          code: 'GITLAB_UNREACHABLE',
          message: 'GitLab is offline.',
          retryable: true,
        }),
      );
    }
    return ipc.gitlabListMrs(tab);
  });
  return gitlabListMrs;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('S-01 Merge requests refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('F-02.4 lists refetch every poll.minutes and when the window gains focus', async () => {
    const gitlabListMrs = countedList();
    renderApp({ screen: 'S-01' }, mockClient({ gitlabListMrs }));
    expect((await column().findAllByRole('button', { name: /^!/ })).length).toBeGreaterThan(0);
    const first = gitlabListMrs.mock.calls.length;
    await advance(3 * MINUTE - 1_000);
    expect(gitlabListMrs).toHaveBeenCalledTimes(first);
    await advance(2_000);
    expect(gitlabListMrs).toHaveBeenCalledTimes(first + 1);
    await act(async () => {
      window.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(gitlabListMrs).toHaveBeenCalledTimes(first + 2);
  });

  it('F-02.4 data older than the interval shows its age and keeps the rows', async () => {
    const gitlabListMrs = countedList(true);
    renderApp({ screen: 'S-01' }, mockClient({ gitlabListMrs }));
    const rows = await column().findAllByRole('button', { name: /^!/ });
    await advance(3 * MINUTE);
    expect(column().queryByText(/^Updated/)).toBeNull();
    await advance(MINUTE);
    expect(column().getByText('Updated 3 min ago')).toBeInTheDocument();
    expect(column().getAllByRole('button', { name: /^!/ })).toHaveLength(rows.length);
  });
});
