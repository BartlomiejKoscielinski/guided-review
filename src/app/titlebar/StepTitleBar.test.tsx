import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SessionMr } from '../../ipc/types/SessionMr';
import { renderApp } from '../../test/renderApp';

const SESSION = 'mock-mr-session-1';
const REPO = { name: 'gr-sandbox', path: 'C:\\Repos\\gr-sandbox' };
const SESSION_MR: SessionMr = {
  mr: {
    iid: 6,
    title: 'Retry in UploadWorker after network loss',
    author: 'Dev Stand-in',
    sourceBranch: 'fix/upload-retry',
    targetBranch: 'main',
  },
  groups: [],
  totalFiles: 3,
  additions: 36,
  deletions: 1,
  commits: 2,
};

describe('S-03 title bar', () => {
  it('F-30.1 shows the repository, !iid and title of the session’s MR, not the mock example', async () => {
    renderApp(
      { screen: 'S-03', sessionId: SESSION },
      {
        repoActive: () => Promise.resolve(REPO),
        sessionMr: () => Promise.resolve(SESSION_MR),
      },
    );
    const bar = within(screen.getByRole('banner'));
    expect(await bar.findByText('!6')).toBeInTheDocument();
    expect(bar.getByText('Retry in UploadWorker after network loss')).toBeInTheDocument();
    expect(bar.getByText('gr-sandbox')).toBeInTheDocument();
    expect(bar.queryByText('mobile-app')).toBeNull();
    expect(bar.queryByText('!482')).toBeNull();
  });

  it('F-30.1 a session without an MR shows only the repository', async () => {
    renderApp(
      { screen: 'S-03', sessionId: 'mock-session-1' },
      {
        repoActive: () => Promise.resolve(REPO),
        sessionMr: () => Promise.resolve(null),
      },
    );
    const bar = within(screen.getByRole('banner'));
    expect(await bar.findByText('gr-sandbox')).toBeInTheDocument();
    expect(bar.queryByText(/^!\d+$/)).toBeNull();
  });
});
