import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { SessionMr } from '../../ipc/types/SessionMr';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-08.1: the Focus | Detailed toggle in the title bar and Ctrl+D switch S-03 and S-04 on the same
// step (`?step=` stays); the switch is the session's mode (M4 decision 4), and both modes show the
// same session state.

const SESSION = 'mock-mr-session-1';
const FIRST = 'Note 1: The whole photo goes into SQLite as byte[]';
const SECOND = 'Note 2: PendingCount won’t refresh after upload';
const STEP = pathFor({ screen: 'S-03', sessionId: SESSION });
const DETAILED = pathFor({ screen: 'S-04', sessionId: SESSION });

const REPO = { name: 'gr-sandbox', path: 'C:\\Repos\\gr-sandbox' };
const SESSION_MR: SessionMr = {
  mr: {
    iid: 6,
    title: 'Retry in UploadWorker after network loss',
    author: 'Dev Stand-in',
    sourceBranch: 'fix/upload-retry',
    targetBranch: 'main',
  },
  groups: [],
  totalFiles: 3,
  additions: 36,
  deletions: 1,
  commits: 2,
};

const bar = () => within(screen.getByRole('banner'));
const mode = () => within(bar().getByRole('radiogroup', { name: 'Mode' }));
const ctrlD = () => userEvent.keyboard('{Control>}d{/Control}');

async function openStep4(client: Partial<IpcClient> = {}) {
  const app = renderApp({ screen: 'S-03', sessionId: SESSION }, client);
  await app.router.navigate(`${STEP}?step=s4`);
  expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
  return app;
}

async function expectAt(
  router: Awaited<ReturnType<typeof openStep4>>['router'],
  pathname: string,
  search = '?step=s4',
) {
  await waitFor(() => {
    expect(router.state.location.pathname).toBe(pathname);
  });
  expect(router.state.location.search).toBe(search);
}

describe('S-03 / S-04 mode toggle (F-08.1)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-08.1 Focus | Detailed in the title bar opens Detailed on the same step and Focus again', async () => {
    const sessionSetMode = vi.fn<IpcClient['sessionSetMode']>(() => Promise.resolve());
    const settings = createMockClient({ latencyMs: 0 });
    const appSettingsSet = vi.fn<IpcClient['appSettingsSet']>((patch) =>
      settings.appSettingsSet(patch),
    );
    const { router } = await openStep4({ sessionSetMode, appSettingsSet });
    expect(mode().getByRole('radio', { name: 'Focus' })).toBeChecked();

    await userEvent.click(mode().getByRole('radio', { name: 'Detailed' }));
    await expectAt(router, DETAILED);
    expect(mode().getByRole('radio', { name: 'Detailed' })).toBeChecked();
    // The S-04 shell replaces the stub: its Guide aside is there, the Focus layouts are not.
    expect(await screen.findByRole('complementary', { name: 'Guide' })).toBeInTheDocument();
    expect(bar().queryByRole('radiogroup', { name: 'Layout' })).toBeNull();

    await userEvent.click(mode().getByRole('radio', { name: 'Focus' }));
    await expectAt(router, STEP);
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
    expect(mode().getByRole('radio', { name: 'Focus' })).toBeChecked();

    // The toggle is the session's mode; Settings › General › Start in is not rewritten.
    expect(sessionSetMode.mock.calls).toEqual([
      [SESSION, 'detailed'],
      [SESSION, 'focus'],
    ]);
    expect(appSettingsSet.mock.calls.some(([patch]) => patch.ui?.startIn !== undefined)).toBe(
      false,
    );
  });

  it('F-08.1 Ctrl+D switches Focus to Detailed and back, keeping the step', async () => {
    const sessionSetMode = vi.fn(() => Promise.resolve());
    const { router } = await openStep4({ sessionSetMode });
    await ctrlD();
    await expectAt(router, DETAILED);
    expect(mode().getByRole('radio', { name: 'Detailed' })).toBeChecked();
    await ctrlD();
    await expectAt(router, STEP);
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
    expect(sessionSetMode).toHaveBeenCalledTimes(2);
  });

  it('F-08.1 Ctrl+D works with the focus in a text field, like the other App shortcuts', async () => {
    const { router } = await openStep4({
      sessionSetMode: () => Promise.resolve(),
    });
    act(() => {
      useFocusStore.getState().setLayout('C');
    });
    const guide = within(screen.getByRole('complementary', { name: 'Guide' }));
    await userEvent.click(guide.getByRole('textbox', { name: 'Ask Claude about this step' }));
    await ctrlD();
    await expectAt(router, DETAILED);
  });

  it('F-08.1 Ctrl+D does nothing outside step review', async () => {
    const { router } = renderApp({ screen: 'S-07', section: 'general' });
    const path = pathFor({ screen: 'S-07', section: 'general' });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(path);
    });
    await ctrlD();
    expect(router.state.location.pathname).toBe(path);
  });

  it('F-08.1 the focused note survives a switch to Detailed and back', async () => {
    await openStep4({ sessionSetMode: () => Promise.resolve() });
    // Step 4 opens on its Should fix (note 2); the reader moves to note 1.
    expect(await screen.findByRole('button', { name: SECOND })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: FIRST }));
    expect(screen.getByRole('button', { name: FIRST })).toHaveAttribute('aria-pressed', 'true');

    await ctrlD();
    await screen.findByRole('complementary', { name: 'Guide' });
    await ctrlD();
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: FIRST })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: SECOND })).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByRole('article', {
        name: 'Claude note: The whole photo goes into SQLite as byte[]',
      }),
    ).toBeInTheDocument();
  });

  it('F-08.1 the Detailed title bar shows the same session as Focus: repository, !iid and title', async () => {
    renderApp(
      { screen: 'S-04', sessionId: SESSION },
      {
        repoActive: () => Promise.resolve(REPO),
        sessionMr: () => Promise.resolve(SESSION_MR),
      },
    );
    expect(await bar().findByText('!6')).toBeInTheDocument();
    expect(bar().getByText('Retry in UploadWorker after network loss')).toBeInTheDocument();
    expect(bar().getByText('gr-sandbox')).toBeInTheDocument();
    expect(bar().queryByText('mobile-app')).toBeNull();
    expect(bar().queryByText('!482')).toBeNull();
  });
});
