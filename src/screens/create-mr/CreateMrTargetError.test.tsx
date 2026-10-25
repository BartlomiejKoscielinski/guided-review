import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

// F-27.1: a target that cannot be counted (gone from origin since the list was read) says why in
// place of the numbers, with the core's copy, and the select stays so another target can be picked.

describe('S-11 branch block, a target that fails (F-27.1)', () => {
  it('F-27.1 a target that is no longer on origin shows the reason and keeps the select', async () => {
    const base = mockClient();
    const gitBranchInfo: IpcClient['gitBranchInfo'] = (target) =>
      target === 'main'
        ? Promise.reject(
            new IpcError({
              code: 'INVALID_INPUT',
              message: 'That target is not a branch on origin.',
              retryable: false,
            }),
          )
        : base.gitBranchInfo(target);
    renderApp({ screen: 'S-11' }, { gitBranchInfo });
    const block = await screen.findByTestId('mr-branch');
    const select = within(block).getByRole('combobox', { name: 'Target branch' });
    await userEvent.selectOptions(select, 'main');
    expect(await within(block).findByRole('alert')).toHaveTextContent(
      'That target is not a branch on origin.',
    );
    await userEvent.selectOptions(select, 'release/1.8');
    expect(await within(block).findByText(/^11 commits · 34 files/)).toBeInTheDocument();
    expect(within(block).queryByRole('alert')).toBeNull();
  });
});
