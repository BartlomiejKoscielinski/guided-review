import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IpcError } from '../../ipc/errors';
import { DEFAULT_SETTINGS, MOCK_SETTINGS_KEY } from '../../ipc/mock';
import type { Settings } from '../../ipc/types/Settings';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

// Settings › General (S-07, Settings.dc.html `{"section":"general"}`), F-19.1.

const GENERAL = { screen: 'S-07', section: 'general' } as const;

const group = (name: string) => screen.getByRole('radiogroup', { name });
const radio = (groupName: string, name: string) =>
  within(group(groupName)).getByRole('radio', { name });

/** Settings as the core would have saved them, with the four General values changed. */
const SAVED: Settings = {
  ...DEFAULT_SETTINGS,
  ui: { ...DEFAULT_SETTINGS.ui, startIn: 'detailed', focusLayout: 'C', diffColors: 'green-red' },
  os: { ...DEFAULT_SETTINGS.os, startWithWindows: true },
};

/** A mock backend that starts with `settings` saved (as after an earlier run of the app). */
function savedClient(settings: Settings) {
  const storage = {
    getItem: (key: string) => (key === MOCK_SETTINGS_KEY ? JSON.stringify(settings) : null),
    setItem: () => undefined,
  };
  return mockClient({}, { storage });
}

afterEach(() => {
  document.documentElement.removeAttribute('data-diff');
});

describe('Settings › General', () => {
  it('F-19.1 shows Start in, Focus layout, Diff colors and Start with Windows with the defaults', async () => {
    renderApp(GENERAL, mockClient());
    expect(await screen.findByRole('heading', { name: 'General', level: 1 })).toBeInTheDocument();
    await screen.findByRole('radiogroup', { name: 'Start in' });

    expect(
      within(group('Start in'))
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Focus', 'Detailed']);
    expect(
      within(group('Focus layout'))
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['A', 'B', 'C']);
    expect(
      within(group('Diff colors'))
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Blue · orange', 'Green · red']);

    expect(radio('Start in', 'Focus')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Start in', 'Detailed')).toHaveAttribute('aria-checked', 'false');
    expect(radio('Focus layout', 'A')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Diff colors', 'Blue · orange')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Diff colors', 'Green · red')).toHaveAttribute('aria-checked', 'false');
    // Default off.
    expect(screen.getByRole('switch', { name: 'Start with Windows' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    // Changes save immediately: there is no Save button (02 › S-07).
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    // The tray row comes with its behaviour in M10 (M4 decision 2).
    expect(screen.queryByText('Keep running in the tray when closed')).not.toBeInTheDocument();
  });

  it('F-19.1 shows the saved values', async () => {
    renderApp(GENERAL, savedClient(SAVED));
    await screen.findByRole('radiogroup', { name: 'Start in' });
    expect(radio('Start in', 'Detailed')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Start in', 'Focus')).toHaveAttribute('aria-checked', 'false');
    expect(radio('Focus layout', 'C')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Focus layout', 'A')).toHaveAttribute('aria-checked', 'false');
    expect(radio('Diff colors', 'Green · red')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Start with Windows' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('F-19.1 Start in saves ui.startIn at once', async () => {
    const user = userEvent.setup();
    const ipc = mockClient();
    const save = vi.spyOn(ipc, 'appSettingsSet');
    renderApp(GENERAL, ipc);
    await screen.findByRole('radiogroup', { name: 'Start in' });
    await user.click(radio('Start in', 'Detailed'));
    expect(save).toHaveBeenLastCalledWith({ ui: { startIn: 'detailed' } });
    await waitFor(() => {
      expect(radio('Start in', 'Detailed')).toHaveAttribute('aria-checked', 'true');
    });
    await user.click(radio('Start in', 'Focus'));
    expect(save).toHaveBeenLastCalledWith({ ui: { startIn: 'focus' } });
  });

  it('F-19.1 Focus layout saves ui.focusLayout at once', async () => {
    const user = userEvent.setup();
    const ipc = mockClient();
    const save = vi.spyOn(ipc, 'appSettingsSet');
    renderApp(GENERAL, ipc);
    await screen.findByRole('radiogroup', { name: 'Focus layout' });
    await user.click(radio('Focus layout', 'C'));
    expect(save).toHaveBeenLastCalledWith({ ui: { focusLayout: 'C' } });
    await waitFor(() => {
      expect(radio('Focus layout', 'C')).toHaveAttribute('aria-checked', 'true');
    });
    await user.click(radio('Focus layout', 'B'));
    expect(save).toHaveBeenLastCalledWith({ ui: { focusLayout: 'B' } });
  });

  it('F-19.1 Diff colors saves ui.diffColors and recolors the diff at once', async () => {
    const user = userEvent.setup();
    const ipc = mockClient();
    const save = vi.spyOn(ipc, 'appSettingsSet');
    renderApp(GENERAL, ipc);
    await screen.findByRole('radiogroup', { name: 'Diff colors' });
    expect(document.documentElement).not.toHaveAttribute('data-diff', 'green-red');

    await user.click(radio('Diff colors', 'Green · red'));
    expect(save).toHaveBeenLastCalledWith({ ui: { diffColors: 'green-red' } });
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-diff', 'green-red');
    });
    expect(radio('Diff colors', 'Green · red')).toHaveAttribute('aria-checked', 'true');

    await user.click(radio('Diff colors', 'Blue · orange'));
    expect(save).toHaveBeenLastCalledWith({ ui: { diffColors: 'blue-orange' } });
    await waitFor(() => {
      expect(document.documentElement).not.toHaveAttribute('data-diff', 'green-red');
    });
  });

  it('F-19.1 Start with Windows saves os.startWithWindows at once', async () => {
    const user = userEvent.setup();
    const ipc = mockClient();
    const save = vi.spyOn(ipc, 'appSettingsSet');
    renderApp(GENERAL, ipc);
    const toggle = await screen.findByRole('switch', { name: 'Start with Windows' });
    await user.click(toggle);
    expect(save).toHaveBeenLastCalledWith({ os: { startWithWindows: true } });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Start with Windows' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });
    await user.click(screen.getByRole('switch', { name: 'Start with Windows' }));
    expect(save).toHaveBeenLastCalledWith({ os: { startWithWindows: false } });
  });

  it('F-19.1 the saved diff colors apply when the app starts, on any screen', async () => {
    renderApp({ screen: 'S-01' }, savedClient(SAVED));
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-diff', 'green-red');
    });
  });

  it('F-19.1 shows no values while the settings load', async () => {
    const ipc = mockClient({ appSettingsGet: () => new Promise<Settings>(() => undefined) });
    renderApp(GENERAL, ipc);
    // The section nav is there; the rows wait for the saved values instead of showing defaults.
    expect(await screen.findByRole('navigation', { name: 'Settings sections' })).toBeVisible();
    expect(screen.queryByRole('radiogroup', { name: 'Start in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Start with Windows' })).not.toBeInTheDocument();
  });

  it('F-19.1 a change that cannot be saved shows the error and keeps the saved value', async () => {
    const user = userEvent.setup();
    const message = 'The settings could not be saved.';
    const ipc = mockClient({
      appSettingsSet: () =>
        Promise.reject(new IpcError({ code: 'INTERNAL', message, retryable: false })),
    });
    renderApp(GENERAL, ipc);
    await screen.findByRole('radiogroup', { name: 'Start in' });
    await user.click(radio('Start in', 'Detailed'));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(radio('Start in', 'Focus')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Start in', 'Detailed')).toHaveAttribute('aria-checked', 'false');
  });
});
