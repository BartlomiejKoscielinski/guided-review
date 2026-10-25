import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { toFileDiff } from '../../ipc/mock/diff';
import { UPLOAD_WORKER_DIFF } from '../../ipc/mock/fixtures/authorMr';
import { useAuthorCommitStore } from '../../state/authorCommit';
import { renderWithIpc } from '../../test/render';
import { AuthorCommitPanel } from './AuthorCommitPanel';

// F-26.4 states the spec and the mock leave open (P-044, P-017): the panel while the fixup target
// loads, when it can't be read, and the file's "+N −M" from its diff.

const PATH = 'src/App/Workers/UploadWorker.cs';
const DIFF = toFileDiff(UPLOAD_WORKER_DIFF);

function show(client: Partial<IpcClient>) {
  useAuthorCommitStore.getState().open('t1', 'Address review on UploadWorker.cs:46');
  renderWithIpc(
    <AuthorCommitPanel
      threadId="t1"
      path={PATH}
      line={46}
      target="develop"
      diff={DIFF}
      project="mobile/mobile-app"
      iid={480}
      author="Marta K."
      branch="feature/upload-retry"
      onOpenRider={() => undefined}
    />,
    client,
  );
  return screen.getByRole('region', { name: 'Commit and push' });
}

describe('S-10 commit panel states (F-26.4)', () => {
  it('F-26.4 while the fixup target loads there is no switch, no note and Commit is disabled', () => {
    const panel = show({ authorFixupTarget: () => new Promise(() => undefined) });

    expect(within(panel).queryByRole('checkbox')).toBeNull();
    expect(panel).not.toHaveTextContent('Stays a separate commit.');
    expect(within(panel).getByRole('button', { name: 'Commit' })).toBeDisabled();
    expect(DIFF.additions).toBeGreaterThan(0);
    expect(panel).toHaveTextContent(
      `UploadWorker.cs +${String(DIFF.additions)} −${String(DIFF.deletions)}`,
    );
  });

  it('F-26.4 a fixup target that cannot be read says why and leaves a separate commit', async () => {
    const gitCommit = vi.fn<IpcClient['gitCommit']>(() =>
      Promise.resolve({ sha: '9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40', shortSha: '9e1d4b7' }),
    );
    const panel = show({
      authorFixupTarget: () =>
        Promise.reject(
          new IpcError({
            code: 'INVALID_INPUT',
            message: 'The target branch develop isn’t in this checkout.',
            retryable: false,
          }),
        ),
      gitCommit,
    });

    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'The target branch develop isn’t in this checkout.',
    );
    expect(within(panel).queryByRole('checkbox')).toBeNull();
    expect(panel).toHaveTextContent('Stays a separate commit.');

    await userEvent.click(within(panel).getByRole('button', { name: 'Commit' }));
    expect(gitCommit).toHaveBeenCalledWith('Address review on UploadWorker.cs:46', false, null, [
      PATH,
    ]);
  });
});
