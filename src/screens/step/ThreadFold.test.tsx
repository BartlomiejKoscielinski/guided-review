import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../app/queryClient';
import type { IpcClient } from '../../ipc/client';
import { IpcProvider } from '../../ipc/IpcProvider';
import { createMockClient } from '../../ipc/mock';
import type { Thread } from '../../ipc/types/Thread';
import { StepScreen } from './StepScreen';

// F-11.3 on S-03: a thread the core placed on a line inside Claude's fold ("Fields and
// constructor", lines 12–31 of step 4) cuts its line and 3 lines on each side out of the fold, so
// the card shows under its line with the lines around it in view and the rest stays folded.

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const FOLD = 'Fields and constructor: 3 new dependencies';
const BODY = 'Should the pending count refresh here as well?';

/** Written on version 3b8d1f0 at line 9; the core placed it on line 14, inside the fold. */
const IN_FOLD: Thread = {
  id: 'f-line',
  resolvable: true,
  resolved: false,
  outdated: true,
  placedLine: 14,
  position: { oldPath: VM, newPath: VM, newLine: 9, headSha: '3b8d1f0', baseSha: '5e2a9c4' },
  notes: [
    {
      id: 9401,
      author: { username: 'anna.k', name: 'Anna K.' },
      body: BODY,
      createdAt: '2026-10-12T08:00:00.000Z',
    },
  ],
};

const real = createMockClient({ latencyMs: 0, review: { planCached: true } });

/** Step views with `threads` added. */
function withThreads(threads: Thread[]): IpcClient {
  return {
    ...real,
    reviewStep: async (sessionId, stepId) => {
      const view = await real.reviewStep(sessionId, stepId);
      return { ...view, threads: [...view.threads, ...threads] };
    },
  };
}

function renderStep(ipc: IpcClient) {
  const router = createMemoryRouter(
    [{ path: '/session/:sessionId/step', element: <StepScreen /> }],
    { initialEntries: [`/session/${SESSION}/step?step=s4`] },
  );
  render(
    <IpcProvider client={ipc}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </IpcProvider>,
  );
}

const addLine = (file: HTMLElement, no: number) =>
  file.querySelector(`[data-kind="add"] [data-line-no="${String(no)}"]`);

describe('S-03 a thread inside a fold (F-11.3)', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-11.3 a thread placed on a line inside Claude’s fold shows with 3 lines on each side, the rest stays folded', async () => {
    renderStep(withThreads([IN_FOLD]));
    const file = await screen.findByRole('region', { name: VM });
    const card = await within(file).findByRole('region', { name: 'Thread at line 14' });
    expect(card).toHaveTextContent(BODY);
    // Lines 12 (the fold's first) to 17 are in view: the card is under line 14, before line 15.
    const line14 = addLine(file, 14);
    const line15 = addLine(file, 15);
    expect(file.querySelector('[data-kind="ctx"] [data-line-no="12"]')).not.toBeNull();
    expect(line15).not.toBeNull();
    expect(addLine(file, 16)).not.toBeNull();
    expect(file.querySelector('[data-kind="ctx"] [data-line-no="17"]')).not.toBeNull();
    expect(
      (line14?.compareDocumentPosition(card) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (card.compareDocumentPosition(line15 ?? card) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).toBe(true);
    // Lines 18–31 are still one closed fold.
    expect(within(file).getByText(FOLD)).toBeInTheDocument();
    expect(file.querySelector('[data-kind="ctx"] [data-line-no="18"]')).toBeNull();
    expect(addLine(file, 20)).toBeNull();
  });

  it('F-11.3 without a thread in it the fold stays closed', async () => {
    renderStep(withThreads([]));
    const file = await screen.findByRole('region', { name: VM });
    expect(await within(file).findByText(FOLD)).toBeInTheDocument();
    expect(addLine(file, 15)).toBeNull();
  });
});
