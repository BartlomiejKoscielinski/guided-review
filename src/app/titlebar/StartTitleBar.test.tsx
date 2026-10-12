import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IpcClient } from '../../ipc/client';
import type { MockOptions } from '../../ipc/mock';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

const bar = () => within(screen.getByTestId('title-bar'));

function renderStart(options: MockOptions = {}, overrides: Partial<IpcClient> = {}) {
  return renderApp({ screen: 'S-01' }, mockClient(overrides, options));
}

describe('S-01 title bar', () => {
  it('F-01.6 shows "GitLab connected" with a green square before the Claude chip', async () => {
    renderStart();
    const status = await bar().findByText('GitLab connected');
    expect(status.querySelector('[data-color="green"]')).not.toBeNull();
    const claude = bar().getByRole('button', { name: 'Claude Code signed in' });
    expect(status.compareDocumentPosition(claude) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('F-01.6 without a token it turns orange and "Add token" opens Settings › GitLab', async () => {
    const user = userEvent.setup();
    const { router } = renderStart({ gitlab: { state: 'noToken' } });
    const add = await bar().findByRole('button', { name: 'Add token' });
    expect(add.querySelector('[data-color="orange"]')).not.toBeNull();
    expect(bar().queryByText('GitLab connected')).toBeNull();
    await user.click(add);
    expect(router.state.location.pathname).toBe('/settings/gitlab');
  });

  it('F-01.6 a rejected token also offers "Add token"', async () => {
    renderStart({ gitlab: { state: 'failing' } });
    expect(await bar().findByRole('button', { name: 'Add token' })).toBeInTheDocument();
  });

  it('F-01.6 an unreachable server shows an orange GitLab chip with the problem', async () => {
    const ipc = mockClient();
    const connected = await ipc.gitlabStatus(false);
    const message = 'GitLab at https://gitlab.local does not answer.';
    renderStart(
      {},
      {
        gitlabStatus: () =>
          Promise.resolve({
            ...connected,
            state: 'failing',
            problem: { code: 'GITLAB_UNREACHABLE', message, retryable: true },
          }),
      },
    );
    const chip = await bar().findByRole('button', { name: 'GitLab' });
    expect(chip).toHaveAttribute('title', message);
  });

  it('F-30.7 the switcher lists the repositories and "Add repository…"', async () => {
    const user = userEvent.setup();
    renderStart();
    await user.click(await bar().findByRole('button', { name: /^Repository mobile-app/ }));
    const menu = screen.getByRole('menu', { name: 'Repositories' });
    await within(menu).findByRole('menuitemradio', { name: /courier-api/ });
    const items = [...menu.querySelectorAll('[role^="menuitem"]')];
    expect(items.map((i) => i.textContent)).toEqual([
      'mobile-appC:\\src\\mobile-app',
      'courier-apiC:\\src\\courier-api',
      'Add repository…',
    ]);
    expect(within(menu).getByRole('menuitemradio', { name: /mobile-app/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(items[0]).toHaveFocus();
  });

  it('F-30.7 picking a repository makes it active for S-01', async () => {
    const user = userEvent.setup();
    const ipc = mockClient();
    const switchSpy = vi.spyOn(ipc, 'repoSwitch');
    renderApp({ screen: 'S-01' }, ipc);
    await user.click(await bar().findByRole('button', { name: /^Repository mobile-app/ }));
    await screen.findByRole('menuitemradio', { name: /courier-api/ });
    await user.keyboard('{ArrowDown}{Enter}');
    expect(switchSpy).toHaveBeenCalledWith(2);
    expect(
      await bar().findByRole('button', { name: 'Repository courier-api, C:\\src\\courier-api' }),
    ).toHaveFocus();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('F-30.7 "Add repository…" opens the folder dialog', async () => {
    const user = userEvent.setup();
    const ipc = mockClient();
    const pick = vi.spyOn(ipc, 'repoPick');
    renderApp({ screen: 'S-01' }, ipc);
    await user.click(await bar().findByRole('button', { name: /^Repository mobile-app/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Add repository…' }));
    expect(pick).toHaveBeenCalledOnce();
  });

  it('F-30.7 Escape and a click outside close the menu', async () => {
    const user = userEvent.setup();
    renderStart();
    const switcher = await bar().findByRole('button', { name: /^Repository mobile-app/ });
    await user.click(switcher);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(switcher).toHaveFocus();
    await user.click(switcher);
    await user.click(bar().getByText('GitLab connected'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
