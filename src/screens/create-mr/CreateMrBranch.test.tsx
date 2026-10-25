import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import type { BranchInfo } from '../../ipc/types/BranchInfo';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

// F-27.1 on S-11 (route {screen:'S-11'}, which is also what the Rider link of M10 opens). Locators
// the screen keeps: heading level 1 "New merge request"; data-testid="mr-branch" around the source
// branch text, the aria-hidden arrow, the select labelled "Target branch" (option text = branch
// name without origin/) and data-testid="mr-branch-stats" with `N commits · N files · +A −D`
// ("+A" and "−D" in a span each); aria-busy="true" (label "Loading branch") while the branch is
// read; role=alert for an error and for no branch; the text "No branch on origin to merge into."
// for no target.

const INFO: BranchInfo = {
  branch: 'chore/compiled-bindings',
  upstream: 'origin/chore/compiled-bindings',
  targets: ['develop', 'main', 'release/1.8'],
  target: 'develop',
  commits: 3,
  files: 12,
  additions: 84,
  deletions: 40,
};

function show(client: Partial<IpcClient> = {}) {
  const base = mockClient();
  const gitBranchInfo = vi.fn<IpcClient['gitBranchInfo']>((target) => base.gitBranchInfo(target));
  renderApp({ screen: 'S-11' }, { gitBranchInfo, ...client });
  return gitBranchInfo;
}

const targetSelect = (block: HTMLElement) =>
  within(block).getByRole('combobox', { name: 'Target branch' });

describe('S-11 branch block (F-27.1)', () => {
  it('F-27.1 shows the heading and source → target with N commits · N files · +/−', async () => {
    show();
    expect(
      screen.getByRole('heading', { level: 1, name: 'New merge request' }),
    ).toBeInTheDocument();
    const block = await screen.findByTestId('mr-branch');
    const select = targetSelect(block);
    expect(select).toHaveValue('develop');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['develop', 'main', 'release/1.8']);
    const stats = within(block).getByTestId('mr-branch-stats');
    expect(stats).toHaveTextContent('3 commits · 12 files · +84 −40');
    expect(within(stats).getByText('+84')).toBeInTheDocument();
    expect(within(stats).getByText('−40')).toBeInTheDocument();
    // Source first, then the target select, then the numbers.
    const source = within(block).getByText('chore/compiled-bindings');
    expect(source.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(select.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('F-27.1 choosing another target asks for it and recomputes the numbers', async () => {
    const gitBranchInfo = show();
    const block = await screen.findByTestId('mr-branch');
    await userEvent.selectOptions(targetSelect(block), 'main');
    await waitFor(() => {
      expect(within(block).getByTestId('mr-branch-stats')).toHaveTextContent(
        '7 commits · 21 files · +190 −88',
      );
    });
    expect(gitBranchInfo).toHaveBeenLastCalledWith('main');
    expect(targetSelect(block)).toHaveValue('main');
  });

  it('F-27.1 while the new target is counted the select shows the choice and the old numbers are gone', async () => {
    const base = mockClient();
    let release: (info: BranchInfo) => void = () => undefined;
    const gitBranchInfo = vi.fn<IpcClient['gitBranchInfo']>((target) =>
      target === 'main'
        ? new Promise<BranchInfo>((resolve) => {
            release = resolve;
          })
        : base.gitBranchInfo(target),
    );
    show({ gitBranchInfo });
    const block = await screen.findByTestId('mr-branch');
    await userEvent.selectOptions(targetSelect(block), 'main');
    expect(targetSelect(block)).toHaveValue('main');
    const stats = within(block).getByTestId('mr-branch-stats');
    expect(stats).toHaveAttribute('aria-busy', 'true');
    expect(stats).not.toHaveTextContent('3 commits');
    release({ ...INFO, target: 'main', commits: 7, files: 21, additions: 190, deletions: 88 });
    await waitFor(() => {
      expect(within(block).getByTestId('mr-branch-stats')).toHaveTextContent(
        '7 commits · 21 files · +190 −88',
      );
    });
  });

  it('F-27.1 one commit and one file are written in the singular', async () => {
    show({ gitBranchInfo: () => Promise.resolve({ ...INFO, commits: 1, files: 1 }) });
    const stats = await screen.findByTestId('mr-branch-stats');
    expect(stats).toHaveTextContent('1 commit · 1 file · +84 −40');
    expect(stats).not.toHaveTextContent('1 commits');
    expect(stats).not.toHaveTextContent('1 files');
  });

  it('F-27.1 while the branch is read the block is busy and has no select', () => {
    show({ gitBranchInfo: () => new Promise(() => undefined) });
    expect(screen.getByLabelText('Loading branch')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('combobox', { name: 'Target branch' })).toBeNull();
  });

  it('F-27.1 a branch that cannot be read says why', async () => {
    show({
      gitBranchInfo: () =>
        Promise.reject(
          new IpcError({
            code: 'INVALID_INPUT',
            message: 'This folder is not a git repository.',
            retryable: false,
          }),
        ),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This folder is not a git repository.',
    );
    expect(screen.queryByRole('combobox', { name: 'Target branch' })).toBeNull();
  });

  it('F-27.1 without origin branches there is nothing to merge into', async () => {
    show({
      gitBranchInfo: () =>
        Promise.resolve({
          branch: 'chore/compiled-bindings',
          targets: [],
          commits: 0,
          files: 0,
          additions: 0,
          deletions: 0,
        }),
    });
    expect(await screen.findByText('No branch on origin to merge into.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Target branch' })).toBeNull();
  });

  it('F-27.1 on a detached HEAD there is no branch to open a merge request for', async () => {
    show({
      gitBranchInfo: () =>
        Promise.resolve({
          targets: ['develop'],
          target: 'develop',
          commits: 0,
          files: 0,
          additions: 0,
          deletions: 0,
        }),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check out a branch to create a merge request.',
    );
  });
});
