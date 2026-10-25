import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthorCommitStore, type AuthorCommitDraft } from '../../state/authorCommit';
import { renderWithIpc } from '../../test/render';
import { AuthorPushPanel } from './AuthorPushPanel';
import { fixedReply } from './authorText';

// F-26.5 states the spec and the mock leave open (P-017): the panel after a successful push
// (F-26.6 adds its sentence and the pipeline's router link, hence the MemoryRouter), Pull first
// with Open in Rider, and a blank reply that can't be pushed.

const COMMITTED = { sha: '9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40', shortSha: '9e1d4b7' };

function show(patch: Partial<AuthorCommitDraft>, onOpenRider = vi.fn()) {
  useAuthorCommitStore.getState().open('t1', 'Backoff doubles');
  useAuthorCommitStore.getState().update('t1', {
    committed: COMMITTED,
    reply: 'Fixed in 9e1d4b7. Backoff doubles.',
    ...patch,
  });
  const draft = useAuthorCommitStore.getState().drafts.t1;
  if (!draft) throw new Error('no draft');
  renderWithIpc(
    <MemoryRouter>
      <AuthorPushPanel
        threadId="t1"
        project="mobile/mobile-app"
        iid={480}
        author="Marta K."
        branch="feature/upload-retry"
        draft={draft}
        committed={COMMITTED}
        onOpenRider={onOpenRider}
      />
    </MemoryRouter>,
    {},
  );
  return onOpenRider;
}

describe('S-10 push panel states (F-26.5)', () => {
  beforeEach(() => {
    useAuthorCommitStore.getState().reset();
  });

  it('F-26.5 after the push the panel says “Pushed” and offers nothing more to send', () => {
    show({ push: 'done' });

    expect(screen.getByText('Pushed')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Reply to send' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Push and reply' })).toBeNull();
  });

  it('F-26.5 Pull first offers Open in Rider and opens it on a click', async () => {
    const onOpenRider = show({ push: 'pullFirst' });

    await userEvent.click(screen.getByRole('button', { name: 'Open in Rider' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Pull first');
    expect(onOpenRider).toHaveBeenCalledTimes(1);
  });

  it('F-26.5 a blank reply can’t be pushed', () => {
    show({ reply: '  ' });

    expect(screen.getByRole('button', { name: 'Push and reply' })).toBeDisabled();
  });

  it('F-26.5 the reply keeps a sentence that already ends and never gets a lone full stop', () => {
    expect(fixedReply('9e1d4b7', 'Stop at 60 s?')).toBe('Fixed in 9e1d4b7. Stop at 60 s?');
    expect(fixedReply('9e1d4b7', 'Backoff doubles\n\nDetails below')).toBe(
      'Fixed in 9e1d4b7. Backoff doubles.',
    );
    expect(fixedReply('9e1d4b7', '')).toBe('Fixed in 9e1d4b7.');
  });
});
