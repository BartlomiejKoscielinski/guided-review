import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Route } from '../ipc/types/Route';
import { mockClient } from '../test/render';
import { recordingClient, renderApp } from '../test/renderApp';

const SESSION = 's1';
const ALL: Route[] = [
  { screen: 'S-01' },
  { screen: 'S-02', sessionId: SESSION },
  { screen: 'S-03', sessionId: SESSION },
  { screen: 'S-04', sessionId: SESSION },
  { screen: 'S-05', sessionId: SESSION },
  { screen: 'S-06' },
  { screen: 'S-07', section: 'general' },
  { screen: 'S-08', iid: 482 },
  { screen: 'S-09', sessionId: SESSION },
  { screen: 'S-10', iid: 480 },
  { screen: 'S-11' },
];

/** Accessible names of the title bar's controls (buttons, radios, groups), without caption buttons. */
function titleBarControls(): string[] {
  const bar = within(screen.getByTestId('title-bar'));
  const groups = bar
    .queryAllByRole('radiogroup')
    .map((g) => `[${g.getAttribute('aria-label') ?? ''}]`);
  const buttons = bar
    .queryAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent)
    .filter((name) => name !== 'Minimize' && name !== 'Maximize' && name !== 'Close');
  return [...groups, ...buttons];
}

const EXPECTED_CONTROLS: Record<Route['screen'], { text: string[]; controls: string[] }> = {
  'S-01': {
    text: ['GitLab connected'],
    controls: ['Repository mobile-app, C:\\src\\mobile-app', 'Claude Code signed in'],
  },
  'S-02': {
    // The session of this test has no MR: no `!iid`; the plan status comes in M3 (F-06.12).
    text: ['mobile-app', 'Review plan'],
    controls: ['Opus 5.5 · high'],
  },
  'S-03': {
    // The session of this test has no MR: the active repository, no `!iid` or title.
    text: ['mobile-app'],
    controls: ['[Mode]', '[Layout]', 'Sonnet 5.5 · medium', 'Finish review'],
  },
  'S-04': {
    // The same session context as S-03 (F-08.1): the active repository, no `!iid` or title.
    text: ['mobile-app'],
    controls: ['[Mode]', 'Sonnet 5.5 · medium', 'Finish review'],
  },
  'S-05': { text: ['!482'], controls: ['Sonnet 5.5 · low'] },
  'S-06': {
    text: ['chore/compiled-bindings'],
    controls: ['Repository mobile-app, C:\\src\\mobile-app', 'Haiku 5.5 · low'],
  },
  'S-07': { text: ['mobile-app', 'Settings'], controls: [] },
  'S-08': { text: ['!482'], controls: ['Sonnet 5.5 · low'] },
  'S-09': {
    text: ['!471', 'Signature screen: field validation'],
    controls: ['Sonnet 5.5 · medium'],
  },
  'S-10': {
    text: ['!480', 'You’re the author', 'Pipeline passed'],
    controls: ['Sonnet 5.5 · medium'],
  },
  'S-11': {
    text: ['chore/compiled-bindings', 'New merge request'],
    controls: ['Sonnet 5.5 · low'],
  },
};

describe('Shell', () => {
  it('F-30.1 each screen shows its title-bar controls', async () => {
    for (const route of ALL) {
      const { unmount } = renderApp(route);
      const expected = EXPECTED_CONTROLS[route.screen];
      const bar = within(screen.getByTestId('title-bar'));
      // S-06 shows the active repository and branch once the mock answers.
      for (const text of expected.text) expect(await bar.findByText(text)).toBeInTheDocument();
      // Model chips come from the settings and the core's model table (F-18.5).
      await waitFor(() => {
        expect(titleBarControls(), route.screen).toEqual(expected.controls);
      });
      unmount();
    }
  });

  it('F-30.1 the model chip opens Settings › Claude', async () => {
    const user = userEvent.setup();
    const { router } = renderApp({ screen: 'S-06' });
    await user.click(await screen.findByRole('button', { name: 'Haiku 5.5 · low' }));
    expect(router.state.location.pathname).toBe('/settings/claude');
  });

  it('F-30.7 Settings shows the active repository, not an example name', async () => {
    const repoActive = () => Promise.resolve({ name: 'gr-sandbox', path: 'C:\\Repos\\gr-sandbox' });
    renderApp({ screen: 'S-07', section: 'general' }, mockClient({ repoActive }));
    const bar = within(screen.getByTestId('title-bar'));
    expect(await bar.findByText('gr-sandbox')).toBeInTheDocument();
    expect(bar.queryByText('mobile-app')).not.toBeInTheDocument();
    expect(bar.getByText('Settings')).toBeInTheDocument();
  });

  it('F-19.4 Settings tile is visible and purple on every screen', () => {
    for (const route of ALL) {
      const { unmount } = renderApp(route);
      const nav = within(screen.getByRole('navigation', { name: 'App' }));
      expect(nav.getByRole('button', { name: /^Settings/ })).toHaveAttribute(
        'data-area',
        'settings',
      );
      unmount();
    }
  });

  it('F-19.4 Ctrl+, opens Settings from any screen', async () => {
    const user = userEvent.setup();
    for (const route of ALL) {
      const { router, unmount } = renderApp(route);
      await user.keyboard('{Control>},{/Control}');
      expect(router.state.location.pathname, route.screen).toBe('/settings/general');
      unmount();
    }
  });

  it('F-19.4 Ctrl+Alt+, (AltGr) does not open Settings', async () => {
    const user = userEvent.setup();
    const { router } = renderApp({ screen: 'S-06' });
    await user.keyboard('{Control>}{Alt>},{/Alt}{/Control}');
    expect(router.state.location.pathname).toBe('/changes');
  });

  it('F-30.4 navigation saves ui.lastRoute', async () => {
    const user = userEvent.setup();
    const ipc = mockClient();
    const save = vi.spyOn(ipc, 'appSettingsSet');
    renderApp({ screen: 'S-01' }, ipc);
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Changes/ }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({ ui: { lastRoute: { screen: 'S-06' } } });
    });
    await user.keyboard('{Control>},{/Control}');
    await waitFor(() => {
      expect(save).toHaveBeenLastCalledWith({
        ui: { lastRoute: { screen: 'S-07', section: 'general' } },
      });
    });
    await expect(ipc.appStartRoute()).resolves.toEqual({ screen: 'S-07', section: 'general' });
  });

  it('F-30.4 restoring the last screen calls no Claude or GitLab command', async () => {
    const { client, calls } = recordingClient(mockClient());
    const { router } = renderApp({ screen: 'S-03', sessionId: SESSION }, client);
    expect(router.state.location.state).toEqual({ restored: true });
    await waitFor(() => {
      expect(calls).toContain('sessionsListUnfinished');
    });
    // Reading the cached Claude status and the model table starts no Claude work; S-03 reads its
    // stored state and resumes from stored data only (F-04.3: no Claude run, no GitLab call).
    // The title bar reads the active repository and the session's stored MR (no GitLab call).
    const allowed =
      /^(app|sessions|sessionState$|sessionResume$|sessionMr$|repoActive$|window|onWindow|claudeStatus$|claudeModels$)/;
    expect(calls.filter((name) => !allowed.test(name))).toEqual([]);
    expect(calls).not.toContain('appSettingsSet');
  });
});
