import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { CommitInfo } from '../../ipc/types/CommitInfo';
import type { Source } from '../../ipc/types/Source';
import { renderApp } from '../../test/renderApp';
import { changeTotals, claimsHeading, sourceTitle } from './sourceText';

const SHA = 'a3f9c12b7e4d6f8091a2b3c4d5e6f708192a3b4c';
const COMMIT: CommitInfo = {
  sha: SHA,
  shortSha: 'a3f9c12',
  parents: [],
  author: 'Marta K.',
  date: '2026-10-14T09:00:00Z',
  subject: 'UploadWorker: jittered backoff',
  body: '',
  groups: [],
  totalFiles: 5,
};

/** A session of commits or local changes: no MR, the mock's plan, the given source. */
function open(source: Source) {
  const mock = createMockClient({ latencyMs: 0 });
  const gitCommitInfo = vi.fn<IpcClient['gitCommitInfo']>(() => Promise.resolve(COMMIT));
  const rendered = renderApp(
    { screen: 'S-02', sessionId: 's1' },
    {
      sessionMr: () => Promise.resolve(null),
      sessionSource: () => Promise.resolve(source),
      gitCommitInfo,
      reviewPlan: (sessionId, onEvent) => mock.reviewPlan(sessionId, onEvent),
    },
  );
  return { ...rendered, gitCommitInfo, mock };
}

describe('S-02 a session without an MR (F-17.1)', () => {
  it('F-17.1 a commit: the plan under its subject, commit messages vs code, Start step 1', async () => {
    const { router, gitCommitInfo, mock } = open({ kind: 'commits', to: SHA });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'UploadWorker: jittered backoff' }),
    ).toBeInTheDocument();
    expect(gitCommitInfo).toHaveBeenCalledWith(SHA);
    expect(await screen.findByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();
    const aside = screen.getByRole('complementary', { name: 'Plan details' });
    expect(
      within(aside).getByRole('heading', { name: 'Commit messages vs code' }),
    ).toBeInTheDocument();
    expect(within(aside).queryByText('MR description vs code')).not.toBeInTheDocument();
    const header = screen.getByRole('heading', { level: 1 }).closest('section') as HTMLElement;
    expect(within(header).getByText(/^Marta K\. · /)).toBeInTheDocument();
    expect(within(header).getByText('a3f9c12')).toBeInTheDocument();
    const totals = changeTotals(await mock.reviewPlan('s2', () => undefined));
    expect(
      within(header).getByText(`${String(totals.files)} files`, { exact: false }),
    ).toBeInTheDocument();
    expect(within(header).getByText(`+${String(totals.additions)}`)).toBeInTheDocument();
    expect(totals.additions).toBeGreaterThan(0);
    const start = screen.getByRole('button', { name: /Start step 1/ });
    expect(start).toBeEnabled();
    await userEvent.click(start);
    expect(router.state.location.pathname).toBe(pathFor({ screen: 'S-03', sessionId: 's1' }));
  });

  it('F-17.1 local changes: the scope as the heading, Enter starts step 1', async () => {
    const { router, gitCommitInfo } = open({
      kind: 'local',
      scope: { kind: 'branchVsTarget', target: 'origin/develop' },
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Whole branch vs develop' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();
    expect(gitCommitInfo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Start step 1/ })).toBeEnabled();
    await userEvent.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe(pathFor({ screen: 'S-03', sessionId: 's1' }));
  });

  it('F-17.1 headings by source', () => {
    expect(sourceTitle({ kind: 'commits', to: SHA }, undefined)).toBe('Commit a3f9c12');
    expect(sourceTitle({ kind: 'commits', from: '9be0d47c2a1f', to: SHA }, 'ignored')).toBe(
      'Commits 9be0d47..a3f9c12',
    );
    expect(sourceTitle({ kind: 'local', scope: { kind: 'uncommitted' } }, undefined)).toBe(
      'Uncommitted changes',
    );
    expect(sourceTitle({ kind: 'local', scope: { kind: 'staged' } }, undefined)).toBe(
      'Staged only',
    );
    expect(claimsHeading(null)).toBe('MR description vs code');
    expect(claimsHeading({ kind: 'commits', to: SHA })).toBe('Commit messages vs code');
    expect(claimsHeading({ kind: 'local', scope: { kind: 'uncommitted' } })).toBe(
      'Description vs code',
    );
  });
});
