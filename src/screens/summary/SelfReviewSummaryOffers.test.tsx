import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import type { StatusSummary } from '../../ipc/types/StatusSummary';
import { renderApp } from '../../test/renderApp';

// F-17.3: the end of a self-review (S-05) offers a draft MR description (F-27.2) and Browse and
// commit (S-06 local mode). The plan row (M7): Draft MR description is shown only when the
// checkout is on a branch with commits ahead of its target; the data is the core's status summary
// (`gitStatusSummary`: branch, branchVsTarget), which the Start screen already reads.

const MR_SESSION = 'mock-mr-session-1';
const MARKS = { files: 0, additions: 0, deletions: 0 };

/** The summary the core gives for a checkout, `branchVsTarget` as given (absent = no target). */
function summary(patch: Partial<StatusSummary>): StatusSummary {
  return {
    branch: 'feature/offline-photos',
    target: 'origin/develop',
    targetName: 'develop',
    uncommitted: MARKS,
    staged: MARKS,
    branchVsTarget: { commits: 3, files: 104 },
    ...patch,
  };
}

interface Options {
  kind?: 'local' | 'commit';
  gitStatusSummary?: IpcClient['gitStatusSummary'];
}

/** S-05 of a self-review session with nothing kept; the router goes to the summary directly. */
async function openSummary({ kind = 'local', gitStatusSummary }: Options = {}) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const { sessionId } =
    kind === 'local'
      ? await base.sessionOpenLocal({ kind: 'staged' })
      : await base.sessionOpenCommit({ to: 'a3f9c12' });
  await base.reviewPlan(sessionId, () => undefined);
  const client: IpcClient = gitStatusSummary ? { ...base, gitStatusSummary } : base;
  const app = renderApp({ screen: 'S-01' }, client);
  await act(() => app.router.navigate(`/session/${sessionId}/summary`));
  expect(await screen.findByRole('heading', { name: /^summary$/i })).toBeInTheDocument();
  return { ...app, sessionId };
}

const draftButton = () => screen.queryByRole('button', { name: 'Draft MR description' });
const browseButton = () => screen.queryByRole('button', { name: 'Browse and commit' });

describe('S-05 self-review summary: what comes next (F-17.3)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-17.3 offers Draft MR description and Browse and commit when the branch is ahead of its target', async () => {
    await openSummary();
    expect(await screen.findByRole('button', { name: 'Draft MR description' })).toBeEnabled();
    expect(browseButton()).toBeEnabled();
  });

  it('F-17.3 offers both when nothing is kept to fix ("Nothing to fix.")', async () => {
    await openSummary();
    expect(await screen.findByText('Nothing to fix.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Draft MR description' })).toBeInTheDocument();
    expect(browseButton()).not.toBeNull();
  });

  it('F-17.3 a review of commits ends with the same two offers', async () => {
    await openSummary({ kind: 'commit' });
    expect(await screen.findByRole('button', { name: 'Draft MR description' })).toBeInTheDocument();
    expect(browseButton()).not.toBeNull();
  });

  it('F-17.3 Draft MR description opens S-11 and asks for the description to be written by that click', async () => {
    const user = userEvent.setup();
    const { router } = await openSummary();
    await user.click(await screen.findByRole('button', { name: 'Draft MR description' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/changes/new-mr');
    });
    // M7 decision 15: the click is the request for the Claude task, carried to S-11 in the
    // navigation state; S-11 starts nothing on its own otherwise.
    expect(router.state.location.state).toEqual({ draftDescription: true });
  });

  it('F-17.3 Browse and commit opens S-06 in local mode', async () => {
    const user = userEvent.setup();
    const { router } = await openSummary();
    await user.click(await screen.findByRole('button', { name: 'Browse and commit' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/changes');
    });
    expect(router.state.location.state).not.toEqual({ draftDescription: true });
  });

  it('F-17.3 on the target branch (no commits ahead) there is no Draft MR description, Browse and commit stays', async () => {
    const gitStatusSummary = vi.fn<IpcClient['gitStatusSummary']>(() =>
      Promise.resolve(summary({ branch: 'develop', branchVsTarget: { commits: 0, files: 0 } })),
    );
    await openSummary({ gitStatusSummary });
    expect(await screen.findByRole('button', { name: 'Browse and commit' })).toBeInTheDocument();
    await waitFor(() => {
      expect(gitStatusSummary).toHaveBeenCalled();
    });
    expect(draftButton()).toBeNull();
  });

  it('F-17.3 without a target branch to compare with there is no Draft MR description', async () => {
    await openSummary({
      gitStatusSummary: () =>
        Promise.resolve({ branch: 'feature/offline-photos', uncommitted: MARKS, staged: MARKS }),
    });
    expect(await screen.findByRole('button', { name: 'Browse and commit' })).toBeInTheDocument();
    expect(draftButton()).toBeNull();
  });

  it('F-17.3 on a detached HEAD there is no Draft MR description (there is no branch to describe)', async () => {
    await openSummary({
      gitStatusSummary: () =>
        Promise.resolve({
          target: 'origin/develop',
          targetName: 'develop',
          uncommitted: MARKS,
          staged: MARKS,
          branchVsTarget: { commits: 3, files: 104 },
        }),
    });
    expect(await screen.findByRole('button', { name: 'Browse and commit' })).toBeInTheDocument();
    expect(draftButton()).toBeNull();
  });

  it('F-17.3 while the branch is looked up Draft MR description is not drawn; Browse and commit already is', async () => {
    await openSummary({ gitStatusSummary: () => new Promise<StatusSummary>(() => undefined) });
    expect(await screen.findByRole('button', { name: 'Browse and commit' })).toBeInTheDocument();
    expect(draftButton()).toBeNull();
  });

  it('F-17.3 when the branch lookup fails Draft MR description stays hidden and Browse and commit works', async () => {
    const user = userEvent.setup();
    const { router } = await openSummary({
      gitStatusSummary: () =>
        Promise.reject(
          new IpcError({ code: 'GIT_FAILED', message: 'git failed.', retryable: false }),
        ),
    });
    expect(await screen.findByRole('button', { name: 'Browse and commit' })).toBeInTheDocument();
    expect(draftButton()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Browse and commit' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/changes');
    });
  });

  it('F-17.3 an MR summary has neither offer', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    await ipc.repoPick();
    const { router } = renderApp({ screen: 'S-01' }, ipc);
    await act(() => router.navigate(`/session/${MR_SESSION}/summary`));
    expect((await screen.findAllByRole('tab')).length).toBeGreaterThan(0);
    expect(draftButton()).toBeNull();
    expect(browseButton()).toBeNull();
  });
});
