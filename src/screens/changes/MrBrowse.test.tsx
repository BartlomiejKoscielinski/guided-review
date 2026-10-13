import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SessionMr } from '../../ipc/types/SessionMr';
import { renderApp } from '../../test/renderApp';

const FILE = 'src/Mobile.Core/Uploads/QueuedPhoto.cs';

const SESSION: SessionMr = {
  mr: {
    iid: 482,
    title: 'Offline queue for delivery photos',
    author: 'Marta K.',
    sourceBranch: 'feature/offline-upload',
    targetBranch: 'develop',
    pipeline: 'passed',
  },
  groups: [
    {
      dir: 'src/Mobile.Core/Uploads',
      files: [
        {
          path: FILE,
          name: 'QueuedPhoto.cs',
          status: 'added',
          binary: false,
          additions: 38,
          deletions: 0,
          untracked: false,
        },
      ],
    },
  ],
  totalFiles: 1,
  additions: 38,
  deletions: 0,
  commits: 3,
};

describe('S-06 MR browse', () => {
  it('F-24.1 Browse files instead opens the MR files read-only; Open in Rider uses the session', async () => {
    const riderOpen = vi.fn(() => Promise.resolve());
    const { router } = renderApp(
      { screen: 'S-02', sessionId: 's1' },
      { sessionMr: () => Promise.resolve(SESSION), riderOpen },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Browse files instead' }));
    expect(router.state.location.pathname).toBe('/changes/mr/s1');

    const details = await screen.findByRole('complementary', { name: 'Merge request details' });
    expect(within(details).getByText('Offline queue for delivery photos')).toBeVisible();
    expect(within(details).getByText('feature/offline-upload → develop')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'MR !482' })).toBeChecked();
    // Read-only: no staging checkboxes.
    expect(screen.queryByRole('checkbox')).toBeNull();

    await userEvent.click(await screen.findByRole('button', { name: 'Open in Rider' }));
    await waitFor(() => {
      expect(riderOpen).toHaveBeenCalledWith(FILE, 1, 's1');
    });
  });

  it('F-24.1 Local changes leaves the MR browse', async () => {
    const { router } = renderApp(
      { screen: 'S-06', sessionId: 's1' },
      { sessionMr: () => Promise.resolve(SESSION) },
    );
    await userEvent.click(await screen.findByRole('radio', { name: 'Local changes' }));
    expect(router.state.location.pathname).toBe('/changes');
  });

  it('F-06.11 Enter on the prepared plan starts step 1', async () => {
    const { router } = renderApp(
      { screen: 'S-02', sessionId: 's1' },
      { sessionMr: () => Promise.resolve(SESSION) },
    );
    expect(await screen.findByText('feature/offline-upload → develop')).toBeVisible();
    await userEvent.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/session/s1/step');
  });
});
