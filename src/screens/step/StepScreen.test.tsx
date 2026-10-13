import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../app/queryClient';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { IpcProvider } from '../../ipc/IpcProvider';
import { mockClient } from '../../test/render';
import { StepScreen } from './StepScreen';

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';

function renderStep(step: string | null, client: Partial<IpcClient> = {}) {
  const ipc = mockClient(client, { review: { planCached: true } });
  const query = step === null ? '' : `?step=${step}`;
  const router = createMemoryRouter(
    [{ path: '/session/:sessionId/step', element: <StepScreen /> }],
    {
      initialEntries: [`/session/${SESSION}/step${query}`],
    },
  );
  render(
    <IpcProvider client={ipc}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </IpcProvider>,
  );
  return router;
}

/** A code line of the diff by its text (no Shiki worker in jsdom, so one text node). */
const code = (text: string) => screen.queryByText(text);
const FIELD = 'private readonly IUploadQueue _queue;';
const ENQUEUE = 'var upload = new PendingUpload(DeliveryId, bytes, DateTimeOffset.UtcNow);';

describe('S-03 layout A', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-07.1 layout A lists the steps by short title in the reader order, the current one marked', async () => {
    const router = renderStep(null);
    const list = await screen.findByRole('navigation', { name: 'Steps' });
    const rows = within(list).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([
      '1Queue contract',
      '2SqliteUploadQueue',
      '3UploadWorker',
      '4ViewModel',
      '5Offline banner',
      '6DI and worker start',
      '7Android',
      '8Tests',
    ]);
    expect(rows[0]).toHaveAttribute('aria-current', 'step');
    expect(within(list).getByText(/Skim · \d+ files/)).toBeInTheDocument();
    await userEvent.click(rows[3] as HTMLElement);
    expect(router.state.location.search).toBe('?step=s4');
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
  });

  it('F-07.2 step header: STEP n OF m, title, description, Mark reviewed and next', async () => {
    const router = renderStep('s4');
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'ViewModel: queue instead of upload' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Instead of uploading right away, it stores the photo and wakes the worker from step 3.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark reviewed' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(router.state.location.search).toBe('?step=s5');
    expect(await screen.findByText('Step 5 of 8')).toBeInTheDocument();
  });

  it('F-07.2 the last step has no next', async () => {
    renderStep('s8');
    expect(await screen.findByText('Step 8 of 8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next step' })).toBeDisabled();
  });

  it('F-07.3 file header: path, +add −del and the number of notes in the file', async () => {
    renderStep('s4');
    const file = await screen.findByRole('region', { name: VM });
    expect(within(file).getByText(VM)).toBeInTheDocument();
    expect(within(file).getByText('+34')).toBeInTheDocument();
    expect(within(file).getByText('−22')).toBeInTheDocument();
    expect(await within(file).findByText('4 notes')).toBeInTheDocument();
  });

  it('F-07.4 a mechanical region is a fold row until Show', async () => {
    renderStep('s4');
    const show = await screen.findByRole('button', { name: 'Show' });
    expect(screen.getByText('Fields and constructor: 3 new dependencies')).toBeInTheDocument();
    expect(code(FIELD)).toBeNull();
    expect(code(ENQUEUE)).not.toBeNull();
    await userEvent.click(show);
    expect(screen.queryByText('Fields and constructor: 3 new dependencies')).toBeNull();
    expect(code(FIELD)).not.toBeNull();
  });

  it('F-07.5 a severity square per note; a square opens its note under the line', async () => {
    renderStep('s4');
    // The step opens on its first Should fix (Review.dc.html's focus f2).
    const second = await screen.findByRole('button', {
      name: 'Note 2: PendingCount won’t refresh after upload',
    });
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(second.className).toMatch(/fix/);
    expect(
      screen.getByRole('article', { name: 'Claude note: PendingCount won’t refresh after upload' }),
    ).toBeInTheDocument();
    const first = screen.getByRole('button', {
      name: 'Note 1: The whole photo goes into SQLite as byte[]',
    });
    await userEvent.click(first);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(
      screen.getByRole('article', {
        name: 'Claude note: The whole photo goes into SQLite as byte[]',
      }),
    ).toBeInTheDocument();
  });

  it('F-07.5 the thread icon marks the line and toggles the read-only thread card', async () => {
    renderStep('s4');
    const icon = await screen.findByRole('button', { name: 'Thread by Paweł S. at line 48' });
    expect(icon).toHaveAttribute('aria-expanded', 'true');
    const thread = screen.getByRole('region', { name: 'Thread at line 48' });
    expect(thread).toHaveTextContent(
      'Kick() is called on the UI thread. Does the worker block anything here?',
    );
    expect(thread).toHaveTextContent(
      'Kick only releases a semaphore, the upload runs in the background.',
    );
    expect(within(thread).getByText('Marta K.')).toBeInTheDocument();
    // Read-only until F-11 (M3 decision 1).
    expect(within(thread).queryByRole('button')).toBeNull();
    await userEvent.click(icon);
    expect(icon).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Thread at line 48' })).toBeNull();
  });

  it('F-07.6 the focused note card carries the decisions', async () => {
    renderStep('s4');
    const card = await screen.findByRole('article', {
      name: 'Claude note: PendingCount won’t refresh after upload',
    });
    expect(within(card).getByRole('button', { name: 'Add to drafts' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('F-07.6 deciding the note the step opened on keeps it focused, with Undo', async () => {
    renderStep('s4');
    const card = await screen.findByRole('article', {
      name: 'Claude note: PendingCount won’t refresh after upload',
    });
    await userEvent.click(within(card).getByRole('button', { name: 'Add to drafts' }));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Note 2: PendingCount won’t refresh after upload' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('F-09.6 S-03: "Claude is reading this step…" while the diff is already there', async () => {
    const reviewFindings: IpcClient['reviewFindings'] = (_s, _step, onEvent) => {
      onEvent({ kind: 'queued' });
      onEvent({ kind: 'started' });
      return new Promise(() => undefined);
    };
    renderStep('s4', { reviewFindings });
    expect(await screen.findByRole('status')).toHaveTextContent('Claude is reading this step…');
    expect(await screen.findByRole('region', { name: VM })).toBeInTheDocument();
    // No folds before the notes: the diff starts with the constructor lines.
    expect(code(FIELD)).not.toBeNull();
  });

  it('F-09.6 S-03: "Couldn\'t analyze this step." with Retry, the diff stays', async () => {
    const reviewFindings: IpcClient['reviewFindings'] = () =>
      Promise.reject(
        new IpcError({ code: 'CLAUDE_FAILED', message: 'Claude Code failed.', retryable: true }),
      );
    renderStep('s4', { reviewFindings });
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't analyze this step.");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: VM })).toBeInTheDocument();
  });

  it('F-09.6 S-03: "Nothing stood out. Read it yourself, though." without notes', async () => {
    renderStep('s1');
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Nothing stood out. Read it yourself, though.',
    );
    expect(screen.queryByRole('button', { name: /^Note / })).toBeNull();
  });
});
