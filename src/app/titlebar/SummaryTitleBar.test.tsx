import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SessionMr } from '../../ipc/types/SessionMr';
import { renderApp } from '../../test/renderApp';

const REPO = { name: 'gr-sandbox', path: 'C:\\Repos\\gr-sandbox' };

function sessionMr(iid: number, title: string): SessionMr {
  return {
    mr: { iid, title, author: 'Dev Stand-in', sourceBranch: 'feat/x', targetBranch: 'main' },
    groups: [],
    totalFiles: 1,
    additions: 1,
    deletions: 0,
    commits: 1,
  };
}

/** Two MRs that share `!5` in different projects, each with its own session. */
const SESSIONS: Record<string, SessionMr> = {
  'mock-mr-session-other': sessionMr(5, 'Other project change'),
  'mock-mr-session-sandbox': sessionMr(5, 'Sandbox change in gr-sandbox'),
};

describe('S-05 title bar', () => {
  it('F-30.1 shows the repository, !iid and title of the session’s MR when two projects share the iid', async () => {
    renderApp(
      { screen: 'S-05', sessionId: 'mock-mr-session-sandbox' },
      {
        repoActive: () => Promise.resolve(REPO),
        sessionMr: (id) => Promise.resolve(SESSIONS[id] ?? null),
      },
    );
    const bar = within(screen.getByRole('banner'));
    expect(await bar.findByText('Sandbox change in gr-sandbox')).toBeInTheDocument();
    expect(bar.getByText('!5')).toBeInTheDocument();
    expect(bar.getByText('gr-sandbox')).toBeInTheDocument();
    expect(bar.queryByText('Other project change')).toBeNull();
    expect(bar.queryByText('mobile-app')).toBeNull();
    expect(bar.queryByText('!482')).toBeNull();
    expect(bar.queryByText('Offline queue for delivery photos')).toBeNull();
  });
});
