import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { chipLabel } from '../../app/titlebar/modelLabel';
import { DEFAULT_SETTINGS } from '../../ipc/mock';
import type { ModelInfo } from '../../ipc/types/ModelInfo';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';
import { statusText } from './claudeStatusText';
import { unsupported } from './efforts';

const MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-mini-9', label: 'Mini 9', efforts: ['low', 'medium'] },
];

describe('Settings › Claude', () => {
  it('F-18.4 unsupported effort levels are disabled with a tooltip', async () => {
    expect(unsupported(MODELS, 'claude-mini-9', 'max')).toBe("Mini 9 doesn't support max.");
    expect(unsupported(MODELS, 'claude-mini-9', 'low')).toBeNull();
    expect(unsupported(MODELS, null, 'max')).toBeNull();

    const ipc = mockClient({ claudeModels: () => Promise.resolve(MODELS) });
    renderApp({ screen: 'S-07', section: 'claude' }, ipc);
    const model = await screen.findByLabelText('Model');
    await userEvent.selectOptions(model, 'claude-mini-9');
    const effort = await screen.findByRole('radiogroup', { name: 'Effort' });
    await waitFor(() => {
      expect(within(effort).getByRole('radio', { name: 'max' })).toBeDisabled();
    });
    expect(within(effort).getByRole('radio', { name: 'max' })).toHaveAttribute(
      'title',
      "Mini 9 doesn't support max.",
    );
    expect(within(effort).getByRole('radio', { name: 'low' })).toBeEnabled();
  });

  it('F-18.2 F-18.3 defaults and per-task overrides save immediately', async () => {
    const user = userEvent.setup();
    const ipc = mockClient();
    const save = vi.spyOn(ipc, 'appSettingsSet');
    renderApp({ screen: 'S-07', section: 'claude' }, ipc);
    await user.click(await screen.findByRole('radio', { name: 'high' }));
    expect(save).toHaveBeenLastCalledWith({ claude: { effort: 'high' } });
    await user.selectOptions(screen.getByLabelText('Writes in'), 'pl');
    expect(save).toHaveBeenLastCalledWith({ claude: { lang: 'pl' } });
    await user.selectOptions(
      screen.getByLabelText('Model for Commit message'),
      'claude-sonnet-5-5',
    );
    expect(save).toHaveBeenLastCalledWith({
      claude: { tasks: { commit: { model: 'claude-sonnet-5-5', effort: 'low' } } },
    });
    expect(screen.getByLabelText('Model for Review plan')).toHaveValue('claude-opus-5-5');
    expect(screen.getByLabelText('Effort for Review plan')).toHaveValue('high');
  });

  it('F-18.6 shows the executable and the task limit', async () => {
    const user = userEvent.setup();
    const ipc = mockClient();
    const save = vi.spyOn(ipc, 'appSettingsSet');
    renderApp({ screen: 'S-07', section: 'claude' }, ipc);
    expect(
      await screen.findByText('C:\\Users\\dev\\.local\\bin\\claude.exe · 2.1.296'),
    ).toBeInTheDocument();
    const limit = screen.getByRole('radiogroup', { name: 'Run at most N Claude tasks at once' });
    expect(within(limit).getByRole('radio', { name: '2' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(limit).getByRole('radio', { name: '3' }));
    expect(save).toHaveBeenLastCalledWith({ claude: { maxConcurrent: 3 } });
  });

  it('F-18.1 status line and Sign in', async () => {
    const user = userEvent.setup();
    const ipc = mockClient({}, { claude: { state: 'notSignedIn' } });
    const signIn = vi.spyOn(ipc, 'claudeSignIn');
    renderApp({ screen: 'S-07', section: 'claude' }, ipc);
    expect(await screen.findByText('Claude Code: not signed in')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in to Claude Code' }));
    expect(signIn).toHaveBeenCalled();
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByText('Claude Code: signed in')).toBeInTheDocument();
  });

  it('F-18.7 the usage limit says when it resets', () => {
    const at = new Date();
    at.setHours(15, 32, 0, 0);
    expect(statusText({ state: 'limited', resetsAt: at.getTime() / 1000 })).toBe(
      'Claude usage limit reached · resets 15:32',
    );
    expect(statusText({ state: 'limited' })).toBe('Claude usage limit reached');
  });

  it('F-18.5 the chip shows the task model and effort', () => {
    const claude = DEFAULT_SETTINGS.claude;
    expect(chipLabel(claude, 'commit', MODELS)).toBe('claude-haiku-5-5 · low');
    expect(chipLabel(claude, 'plan', MODELS)).toBe('Opus 5.5 · high');
    expect(chipLabel(claude, 'ask', MODELS)).toBe('Claude Code default · low');
    const sonnet = { ...claude, model: 'claude-opus-5-5', effort: 'max' as const };
    expect(
      chipLabel(
        { ...sonnet, tasks: { ...claude.tasks, ask: { model: 'default', effort: 'default' } } },
        'ask',
        MODELS,
      ),
    ).toBe('Opus 5.5 · max');
  });
});
