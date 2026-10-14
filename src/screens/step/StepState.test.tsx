import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../app/queryClient';
import type { IpcClient } from '../../ipc/client';
import { IpcProvider } from '../../ipc/IpcProvider';
import { mockClient } from '../../test/render';
import { recordingClient } from '../../test/renderApp';
import { useFocusStore } from '../../state/focus';
import { StepScreen } from './StepScreen';

// F-04.3: S-03 opens on the step the session was on, in its layout; a restored S-03 (F-30.4)
// shows it from stored data only.

const SESSION = 'mock-mr-session-1';
const ignore = () => undefined;
/** Commands that may run Claude or call GitLab. */
const WORK = /^(review|gitlab|drafts|claude(?!Status$|Models$))/;

function renderStep(ipc: IpcClient, restored = false) {
  const router = createMemoryRouter(
    [{ path: '/session/:sessionId/step', element: <StepScreen /> }],
    {
      initialEntries: [
        { pathname: `/session/${SESSION}/step`, state: restored ? { restored: true } : null },
      ],
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

/** The session planned, step 4 opened (its notes analyzed) and left on step 4. */
async function onStep4(ipc: IpcClient) {
  await ipc.reviewPlan(SESSION, ignore);
  await ipc.reviewFindings(SESSION, 's4', ignore);
  await ipc.sessionSetStep(SESSION, 's4');
}

describe('S-03 session state (F-04.3)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-04.3 S-03 opens on the step the session was on and keeps the step you open', async () => {
    const ipc = mockClient();
    await onStep4(ipc);
    renderStep(ipc);
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
    const list = screen.getByRole('navigation', { name: 'Steps' });
    expect(within(list).getByRole('button', { name: /ViewModel/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await userEvent.click(within(list).getByRole('button', { name: /SqliteUploadQueue/ }));
    expect(await screen.findByText('Step 2 of 8')).toBeInTheDocument();
    await waitFor(async () => {
      expect((await ipc.sessionState(SESSION)).currentStep).toBe('s2');
    });
  });

  it('F-04.3 a new session opens on step 1 and keeps it', async () => {
    const ipc = mockClient();
    await ipc.reviewPlan(SESSION, ignore);
    renderStep(ipc);
    expect(await screen.findByText('Step 1 of 8')).toBeInTheDocument();
    await waitFor(async () => {
      expect((await ipc.sessionState(SESSION)).currentStep).toBe('s1');
    });
  });

  it('F-04.3 S-03 shows the session’s layout and keeps the one you pick', async () => {
    const ipc = mockClient();
    await onStep4(ipc);
    await ipc.sessionSetLayout(SESSION, 'B');
    renderStep(ipc);
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
    await waitFor(() => {
      expect(useFocusStore.getState().layout).toBe('B');
    });
    expect(screen.queryByRole('navigation', { name: 'Steps' })).toBeNull();
    useFocusStore.getState().setLayout('C');
    await waitFor(async () => {
      expect((await ipc.sessionState(SESSION)).layout).toBe('C');
    });
  });

  it('F-04.3 F-30.4 restored S-03 shows the stored step and its cached notes, no Claude or GitLab', async () => {
    const base = mockClient();
    await onStep4(base);
    await base.reviewDecide('f2', { kind: 'addToDrafts' });
    const { client, calls } = recordingClient(base);
    renderStep(client, true);
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'ViewModel: queue instead of upload' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('3 notes')).toBeInTheDocument();
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
    expect(calls).toContain('sessionResume');
  });

  it('F-04.3 F-30.4 restored S-03 without cached notes asks Claude for none', async () => {
    const base = mockClient();
    await base.reviewPlan(SESSION, ignore);
    await base.sessionSetStep(SESSION, 's2');
    const { client, calls } = recordingClient(base);
    renderStep(client, true);
    expect(await screen.findByText('Step 2 of 8')).toBeInTheDocument();
    expect(screen.queryByText('Claude is reading this step…')).toBeNull();
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
  });

  it('F-04.3 F-30.4 restored S-03 of a session without a cached plan stays empty', async () => {
    const { client, calls } = recordingClient(mockClient());
    renderStep(client, true);
    await waitFor(() => {
      expect(calls).toContain('sessionResume');
    });
    expect(screen.queryByText(/Step \d of 8/)).toBeNull();
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
  });
});
