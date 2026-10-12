import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IpcError } from '../../ipc/errors';
import type { IpcClient } from '../../ipc/client';
import type { OpenedSession } from '../../ipc/types/OpenedSession';
import type { PrepareProgress } from '../../ipc/types/PrepareProgress';
import type { SessionMr } from '../../ipc/types/SessionMr';
import { useStartStore } from '../../state/start';
import { renderApp } from '../../test/renderApp';

const TITLE = 'Offline queue for delivery photos';

const SESSION: SessionMr = {
  mr: {
    iid: 482,
    title: TITLE,
    author: 'Marta K.',
    sourceBranch: 'feature/offline-upload',
    targetBranch: 'develop',
    pipeline: 'passed',
  },
  groups: [],
  totalFiles: 16,
  additions: 462,
  deletions: 61,
  commits: 3,
};

/** `sessionOpenMr` the test drives: stages and the end come from the test. */
function controlledOpen() {
  const state: {
    progress: (p: PrepareProgress) => void;
    resolve: (o: OpenedSession) => void;
    reject: (e: unknown) => void;
    task: string;
  } = { progress: () => undefined, resolve: () => undefined, reject: () => undefined, task: '' };
  const sessionOpenMr: IpcClient['sessionOpenMr'] = (_iid, _project, task, onProgress) => {
    state.task = task;
    state.progress = onProgress;
    return new Promise<OpenedSession>((resolve, reject) => {
      state.resolve = resolve;
      state.reject = reject;
    });
  };
  return { state, sessionOpenMr };
}

async function openFromStart(client: Partial<IpcClient>) {
  const app = renderApp({ screen: 'S-01' }, client);
  const input = await screen.findByLabelText(/Paste a merge request link/);
  await userEvent.type(input, '!482{Enter}');
  return app;
}

function stage(name: string): HTMLElement {
  const region = screen.getByRole('region', { name: 'Preparation' });
  return within(region).getByText(name);
}

afterEach(() => {
  act(() => {
    useStartStore.setState({ preparing: null });
  });
});

describe('S-02 Preparing', () => {
  it('F-05.6 shows the stages with the MR title once GitLab answered, then the plan', async () => {
    const open = controlledOpen();
    const sessionMr = vi.fn(() => Promise.resolve(SESSION));
    const { router } = await openFromStart({ sessionOpenMr: open.sessionOpenMr, sessionMr });
    await waitFor(() => {
      expect(open.state.task).not.toBe('');
    });
    // Before GitLab answers, S-01 stays (a 404 is shown there, F-01.5).
    expect(router.state.location.pathname).toBe('/');

    act(() => {
      open.state.progress({ stage: 'fetching', iid: 482, title: TITLE });
    });
    expect(await screen.findByRole('heading', { level: 1, name: TITLE })).toBeInTheDocument();
    expect(stage('Fetching !482').className).toMatch(/current/);
    expect(stage('Creating worktree').className).toMatch(/pending/);

    act(() => {
      open.state.progress({ stage: 'creatingWorktree' });
      open.state.progress({ stage: 'computingDiff', files: 16 });
    });
    expect(stage('Fetching !482').className).toMatch(/done/);
    expect(stage('Computing diff · 16 files').className).toMatch(/current/);

    act(() => {
      open.state.resolve({ sessionId: 's1', route: { screen: 'S-02', sessionId: 's1' } });
    });
    expect(await screen.findByRole('button', { name: 'Browse files instead' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/session/s1/plan');
    expect(sessionMr).toHaveBeenCalledWith('s1');
  });

  it('F-05.6 Cancel stops the preparation and goes back to S-01', async () => {
    const open = controlledOpen();
    const sessionPrepareCancel = vi.fn(() => Promise.resolve());
    const { router } = await openFromStart({
      sessionOpenMr: open.sessionOpenMr,
      sessionPrepareCancel,
    });
    await waitFor(() => {
      expect(open.state.task).not.toBe('');
    });
    act(() => {
      open.state.progress({ stage: 'fetching', iid: 482, title: TITLE });
      open.state.progress({ stage: 'creatingWorktree' });
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(sessionPrepareCancel).toHaveBeenCalledWith(open.state.task);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    act(() => {
      open.state.reject(
        new IpcError({ code: 'CANCELLED', message: 'Cancelled.', retryable: false }),
      );
    });
    expect(await screen.findByLabelText(/Paste a merge request link/)).toBeInTheDocument();
    expect(useStartStore.getState().preparing).toBeNull();
  });

  it('F-05.6 a failure after GitLab answered stays on S-02 with its message', async () => {
    const open = controlledOpen();
    const { router } = await openFromStart({ sessionOpenMr: open.sessionOpenMr });
    await waitFor(() => {
      expect(open.state.task).not.toBe('');
    });
    act(() => {
      open.state.progress({ stage: 'fetching', iid: 482, title: TITLE });
      open.state.progress({ stage: 'creatingWorktree' });
      open.state.reject(
        new IpcError({
          code: 'WORKTREE_FAILED',
          message: 'The review worktree could not be created.',
          retryable: true,
        }),
      );
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The review worktree could not be created.',
    );
    expect(stage('Creating worktree').className).toMatch(/failed/);
    await userEvent.click(screen.getByRole('button', { name: 'Back to start' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });

  it('F-05.6 the Preparing path without a preparation goes to S-01', async () => {
    const { router } = renderApp({ screen: 'S-01' });
    await act(() => router.navigate('/preparing'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });
});
