import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { StatusSummary } from '../../ipc/types/StatusSummary';
import { renderApp } from '../../test/renderApp';

// F-17.3 regression: on the local target branch with unpushed commits the core still counts
// commits ahead of origin/<target>, but there is no MR to describe (it would go from develop into
// develop), so Draft MR description stays hidden.

const MARKS = { files: 0, additions: 0, deletions: 0 };

describe('S-05 self-review summary on the target branch (F-17.3)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-17.3 on the target branch with unpushed commits there is no Draft MR description', async () => {
    const onTarget: StatusSummary = {
      branch: 'develop',
      target: 'origin/develop',
      targetName: 'develop',
      uncommitted: MARKS,
      staged: MARKS,
      branchVsTarget: { commits: 2, files: 5 },
    };
    const gitStatusSummary = vi.fn<IpcClient['gitStatusSummary']>(() => Promise.resolve(onTarget));
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    const { sessionId } = await base.sessionOpenLocal({ kind: 'staged' });
    await base.reviewPlan(sessionId, () => undefined);
    const app = renderApp({ screen: 'S-01' }, { ...base, gitStatusSummary });
    await act(() => app.router.navigate(`/session/${sessionId}/summary`));

    expect(await screen.findByRole('button', { name: 'Browse and commit' })).toBeInTheDocument();
    await waitFor(() => {
      expect(gitStatusSummary).toHaveBeenCalled();
    });
    // Give the resolved summary a render pass before checking the button stays hidden.
    await act(() => Promise.resolve());
    expect(screen.queryByRole('button', { name: 'Draft MR description' })).toBeNull();
  });
});
