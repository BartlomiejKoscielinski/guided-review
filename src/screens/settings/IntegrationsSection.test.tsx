import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MOCK_RIDER } from '../../ipc/mock/rider';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

describe('Settings › Integrations', () => {
  it('F-24.4 shows the detected Rider and where teammates’ MRs open from', async () => {
    const user = userEvent.setup();
    const ipc = mockClient();
    const save = vi.spyOn(ipc, 'appSettingsSet');
    renderApp({ screen: 'S-07', section: 'integrations' }, ipc);
    expect(await screen.findByText('Found 2026.2')).toBeInTheDocument();
    expect(screen.getByText(MOCK_RIDER.path ?? '')).toBeInTheDocument();
    const openFrom = screen.getByLabelText('Teammates’ MRs open from');
    expect(openFrom).toHaveValue('worktree');
    expect(screen.getByText('Your own branch stays untouched.')).toBeInTheDocument();
    await user.selectOptions(openFrom, 'checkout');
    expect(save).toHaveBeenLastCalledWith({ rider: { openFrom: 'checkout' } });
    expect(await screen.findByText('Only when that branch is checked out.')).toBeInTheDocument();
  });

  it('F-24.4 Change picks the path when Rider was not found', async () => {
    const user = userEvent.setup();
    const ipc = mockClient({}, { rider: { notFound: true } });
    renderApp({ screen: 'S-07', section: 'integrations' }, ipc);
    expect(await screen.findAllByText('Not found')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(await screen.findByText('Found 2026.2')).toBeInTheDocument();
    await waitFor(async () => {
      expect((await ipc.appSettingsGet()).rider.path).toBe(MOCK_RIDER.path);
    });
  });
});
