import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import type { WaitingReply } from '../../ipc/types/WaitingReply';
import { renderWithIpc } from '../../test/render';
import { AuthorCommitPanel } from './AuthorCommitPanel';

// F-26.5 review fix, M7 decision 12: a reply found queued on reopen (no draft in this run) gets
// its own panel and is never sent by itself. Copy the spec leaves open is locked here (P-017):
// the caption and note of the pushed state and "Sending the reply…".

const SHA = '9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40';
const BODY = 'Fixed in 9e1d4b7. Backoff doubles.';

function waiting(pushed: boolean, error: string | null = null): WaitingReply {
  return {
    reply: {
      id: 'queued-reply-7',
      discussion: 't1',
      body: BODY,
      resolve: true,
      afterSha: SHA,
      state: 'queued',
      error,
    },
    pushed,
  };
}

function show(w: WaitingReply | undefined, client: Partial<IpcClient> = {}) {
  const ipc = {
    authorQueueReply: vi.fn(() => Promise.resolve(w?.reply ?? waiting(false).reply)),
    authorPushAndReply: vi.fn(() =>
      Promise.resolve({
        kind: 'done' as const,
        remoteBranch: 'origin/feature/upload-retry',
        resolved: true,
      }),
    ),
    ...client,
  };
  renderWithIpc(
    <AuthorCommitPanel
      threadId="t1"
      path="src/App/Workers/UploadWorker.cs"
      line={42}
      target="develop"
      diff={undefined}
      project="mobile/mobile-app"
      iid={480}
      author="Marta K."
      branch="feature/upload-retry"
      waiting={w}
      onOpenRider={vi.fn()}
    />,
    ipc,
  );
  return ipc;
}

describe('S-10 a reply still queued on reopen (F-26.5, decision 12)', () => {
  it('F-26.5 a queued reply whose commit is on the remote shows Pushed. Reply not sent yet. with Send reply', () => {
    const ipc = show(waiting(true));

    const panel = screen.getByRole('region', { name: 'Commit and push' });
    expect(panel).toHaveTextContent('Pushed.Reply not sent yet.');
    expect(panel).toHaveTextContent('Sent to Marta’s thread');
    expect(panel).toHaveTextContent('Nothing is sent until you click Send reply.');
    expect(screen.getByRole('textbox', { name: 'Reply to send' })).toHaveValue(BODY);
    expect(screen.getByRole('checkbox', { name: 'Resolve the thread' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeEnabled();
    expect(ipc.authorQueueReply).not.toHaveBeenCalled();
    expect(ipc.authorPushAndReply).not.toHaveBeenCalled();
  });

  it('F-26.5 Send reply sends the queued reply once, on the click, then says Pushed', async () => {
    const ipc = show(waiting(true));

    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(await screen.findByText('Pushed')).toBeInTheDocument();
    expect(ipc.authorQueueReply).toHaveBeenCalledWith(
      'mobile/mobile-app',
      480,
      't1',
      BODY,
      true,
      SHA,
    );
    expect(ipc.authorPushAndReply).toHaveBeenCalledTimes(1);
    expect(ipc.authorPushAndReply).toHaveBeenCalledWith('mobile/mobile-app', 480, 'queued-reply-7');
  });

  it('F-26.5 a queued reply not on the remote yet shows Committed <sha> · not pushed yet with Push and reply', () => {
    show(waiting(false));

    const panel = screen.getByRole('region', { name: 'Commit and push' });
    expect(panel).toHaveTextContent('Committed9e1d4b7not pushed yet');
    expect(screen.getByRole('button', { name: 'Push and reply' })).toBeEnabled();
  });

  it('F-26.5 the failure stored before the restart shows with Retry, and a new failure keeps it', async () => {
    const failed = new IpcError({
      code: 'CONFLICT',
      message: 'Check out feature/upload-retry to push.',
      retryable: false,
    });
    show(waiting(true, 'GitLab is not reachable.'), {
      authorPushAndReply: vi.fn(() => Promise.reject(failed)),
    });

    expect(screen.getByRole('alert')).toHaveTextContent('GitLab is not reachable.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Check out feature/upload-retry to push.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('F-26.5 without a queued reply and without a draft the thread has no commit panel', () => {
    show(undefined);

    expect(screen.queryByRole('region', { name: 'Commit and push' })).toBeNull();
  });
});
