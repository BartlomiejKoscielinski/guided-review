import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { useAuthorCommitStore } from '../../state/authorCommit';
import { renderApp } from '../../test/renderApp';

// F-26.8 review fixes on S-10, against the mock backend's !480:
//  - The checkout state follows the user's checkout: when the app window gets focus again, S-10
//    reads `author_mr` (its `onSourceBranch`) and the uncommitted files again, so checking out
//    the branch in Rider or a terminal brings Fix back, and switching away hides Fix and Commit,
//    without reopening the screen.
//  - M7 decision 10: when files other than the thread's have uncommitted changes, "You have other
//    uncommitted changes. They won't be part of this commit." shows above the fix actions (no
//    Stash link); not for the thread's own file, not in read-only mode.
//  - A refresh that fails keeps the threads on screen (the error replaces the list only when
//    there is nothing to show).

const PROJECT = 'mobile/mobile-app';
const IID = 480;
const PATH = 'src/App/Workers/UploadWorker.cs';
const NOTICE = 'Check out feature/upload-retry to fix here. The app never switches your branch.';
const WARNING = "You have other uncommitted changes. They won't be part of this commit.";

type AuthorMr = Awaited<ReturnType<IpcClient['authorMr']>>;

interface Backend {
  /** What `authorMr` answers next: the checkout state, or a failure. */
  onSourceBranch: boolean | 'fails';
  uncommitted: string[];
}

async function openAuthor(state: Backend) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const mr: AuthorMr = await base.authorMr(PROJECT, IID);
  const authorMr = vi.fn(() =>
    state.onSourceBranch === 'fails'
      ? Promise.reject(
          new IpcError({
            code: 'GITLAB_UNREACHABLE',
            message: 'GitLab can’t be reached.',
            retryable: true,
          }),
        )
      : Promise.resolve({ ...mr, onSourceBranch: state.onSourceBranch }),
  );
  const authorUncommittedFiles = vi.fn(() => Promise.resolve([...state.uncommitted]));
  const app = renderApp(
    { screen: 'S-01' },
    { ...base, authorMr, authorUncommittedFiles, riderOpen: () => Promise.resolve() },
  );
  await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));
  return { authorMr, authorUncommittedFiles };
}

const card = () => screen.findByRole('region', { name: 'Thread' });
const focusWindow = () => {
  act(() => {
    fireEvent.focus(window);
  });
};

describe('S-10 follows the checkout and warns about other changes (F-26.8)', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so a virtual list renders its rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthorCommitStore.getState().reset();
  });

  it('F-26.8 checking out the source branch and coming back to the window brings Fix back', async () => {
    const state: Backend = { onSourceBranch: false, uncommitted: [] };
    const { authorMr } = await openAuthor(state);
    await card();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fix with Claude' })).toBeNull();

    const before = authorMr.mock.calls.length;
    state.onSourceBranch = true;
    focusWindow();

    expect(
      await within(await card()).findByRole('button', { name: 'Fix with Claude' }),
    ).toBeEnabled();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(authorMr.mock.calls.length).toBeGreaterThan(before);
  });

  it('F-26.8 switching to another branch and coming back hides Fix and Commit', async () => {
    const state: Backend = { onSourceBranch: true, uncommitted: [] };
    await openAuthor(state);
    const thread = within(await card());
    expect(await thread.findByRole('button', { name: 'Fix with Claude' })).toBeEnabled();
    useAuthorCommitStore.getState().open('author-t1', 'Address review on UploadWorker.cs:46');
    expect(await screen.findByRole('button', { name: 'Commit' })).toBeInTheDocument();

    state.onSourceBranch = false;
    focusWindow();

    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fix with Claude' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fix in Rider' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled();
  });

  it('F-26.8 a refresh on focus that fails keeps the threads and the last checkout state', async () => {
    const state: Backend = { onSourceBranch: true, uncommitted: [] };
    const { authorMr } = await openAuthor(state);
    expect(
      await within(await card()).findByRole('button', { name: 'Fix with Claude' }),
    ).toBeEnabled();

    const before = authorMr.mock.calls.length;
    state.onSourceBranch = 'fails';
    focusWindow();
    await waitFor(() => {
      expect(authorMr.mock.calls.length).toBeGreaterThan(before);
    });
    // Let the failed read settle before looking at the screen.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(screen.getByRole('listbox', { name: 'Threads' })).toBeInTheDocument();
    expect(screen.queryByText('GitLab can’t be reached.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Fix with Claude' })).toBeEnabled();
  });

  it('F-26.8 other uncommitted files show the warning above the fix actions', async () => {
    await openAuthor({ onSourceBranch: true, uncommitted: [PATH, 'README.md'] });
    const thread = within(await card());

    const warning = await thread.findByText(WARNING);
    const fix = thread.getByRole('button', { name: 'Fix with Claude' });
    expect(warning.compareDocumentPosition(fix) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(warning.closest('[role="note"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /stash/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /stash/i })).toBeNull();
  });

  it('F-26.8 changes to the thread’s own file alone, or none, show no warning', async () => {
    const { authorUncommittedFiles } = await openAuthor({
      onSourceBranch: true,
      uncommitted: [PATH],
    });
    const thread = within(await card());
    expect(await thread.findByRole('button', { name: 'Fix with Claude' })).toBeEnabled();
    await waitFor(() => {
      expect(authorUncommittedFiles).toHaveBeenCalled();
    });

    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it('F-26.8 read-only author mode shows no warning and reads no uncommitted files', async () => {
    const { authorUncommittedFiles } = await openAuthor({
      onSourceBranch: false,
      uncommitted: ['README.md'],
    });
    await card();

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByText(WARNING)).toBeNull();
    expect(authorUncommittedFiles).not.toHaveBeenCalled();
  });

  it('F-26.8 the warning follows the working tree when the window gets focus', async () => {
    const state: Backend = { onSourceBranch: true, uncommitted: [] };
    await openAuthor(state);
    const thread = within(await card());
    expect(await thread.findByRole('button', { name: 'Fix with Claude' })).toBeEnabled();
    expect(screen.queryByText(WARNING)).toBeNull();

    state.uncommitted = ['docs/Notatki ąę.md'];
    focusWindow();

    expect(await thread.findByText(WARNING)).toBeInTheDocument();
  });
});
