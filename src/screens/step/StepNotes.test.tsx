import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { NOTES_STEP } from '../../ipc/mock/fixtures/review';
import { mockClient, renderWithIpc } from '../../test/render';
import { StepNotes } from './StepNotes';

const SESSION = 'mock-mr-session-1';

describe('StepNotes', () => {
  it('F-09.6 "Claude is reading this step…" while the step task runs', async () => {
    const reviewFindings: IpcClient['reviewFindings'] = (_s, _step, onEvent) => {
      onEvent({ kind: 'queued' });
      onEvent({ kind: 'started' });
      return new Promise(() => undefined);
    };
    renderWithIpc(<StepNotes sessionId={SESSION} stepId={NOTES_STEP} />, { reviewFindings });
    expect(await screen.findByRole('status')).toHaveTextContent('Claude is reading this step…');
  });

  it('F-09.6 "Couldn\'t analyze this step." and Retry runs the step again', async () => {
    const mock = mockClient();
    let calls = 0;
    const reviewFindings: IpcClient['reviewFindings'] = (sessionId, stepId, onEvent) => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(
          new IpcError({ code: 'CLAUDE_FAILED', message: 'Claude Code failed.', retryable: true }),
        );
      }
      return mock.reviewFindings(sessionId, stepId, onEvent);
    };
    renderWithIpc(<StepNotes sessionId={SESSION} stepId={NOTES_STEP} />, { reviewFindings });
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't analyze this step.");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findAllByRole('article')).toHaveLength(4);
    expect(calls).toBe(2);
  });

  it('F-09.6 "Nothing stood out. Read it yourself, though." when the step has no notes', async () => {
    renderWithIpc(<StepNotes sessionId={SESSION} stepId="s1" />);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Nothing stood out. Read it yourself, though.',
    );
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('F-09.6 a step with notes shows its cards in diff order', async () => {
    renderWithIpc(<StepNotes sessionId={SESSION} stepId={NOTES_STEP} />);
    const cards = await screen.findAllByRole('article');
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Claude note: The whole photo goes into SQLite as byte[]',
      'Claude note: PendingCount won’t refresh after upload',
      'Claude note: Status texts are hardcoded',
      'Claude note: catch (Exception) also catches camera cancellation',
    ]);
  });
});
