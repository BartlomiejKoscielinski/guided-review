import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IpcClient } from '../../ipc/client';
import type { MockOptions } from '../../ipc/mock';
import type { MrRow } from '../../ipc/types/MrRow';
import type { Route } from '../../ipc/types/Route';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

const HOUR = 3_600_000;

/** An MR session that opens at once (the mock's preparation takes 4 × 400 ms). */
const quickMr: Pick<IpcClient, 'sessionOpenMr'> = {
  sessionOpenMr: (_iid, _project, _task, onProgress) => {
    onProgress({ stage: 'creatingWorktree' });
    return Promise.resolve({ sessionId: 'mr-1', route: { screen: 'S-02', sessionId: 'mr-1' } });
  },
};

function renderStart(
  overrides: Partial<IpcClient> = {},
  options: MockOptions = {},
  start: Route = { screen: 'S-01' },
) {
  const ipc = mockClient({ ...quickMr, ...overrides }, options);
  return { ipc, ...renderApp(start, ipc) };
}

const input = () => screen.getByLabelText(/Paste a merge request link/);
const column = () => within(screen.getByRole('region', { name: 'Merge requests' }));

describe('S-01 hero', () => {
  it('F-01.2 shows the detected type next to the input once typing pauses', async () => {
    const user = userEvent.setup();
    renderStart();
    await user.type(input(), '!482');
    expect(await screen.findByText('Merge request !482')).toBeInTheDocument();
    await user.clear(input());
    await user.type(input(), '9be0d47');
    expect(await screen.findByText('Commit 9be0d47')).toBeInTheDocument();
    expect(screen.queryByText('Merge request !482')).toBeNull();
    await user.clear(input());
    await user.type(input(), 'develop');
    expect(await screen.findByText('Branch develop')).toBeInTheDocument();
  });

  it('F-01.2 an MR link is detected as its merge request', async () => {
    const user = userEvent.setup();
    renderStart();
    await user.click(input());
    await user.paste('https://gitlab.local/mobile/mobile-app/-/merge_requests/479');
    expect(await screen.findByText('Merge request !479')).toBeInTheDocument();
  });

  it('F-01.3 Enter on a merge request prepares it and opens the plan (S-02)', async () => {
    const user = userEvent.setup();
    const open = vi.fn(quickMr.sessionOpenMr);
    const { router } = renderStart({ sessionOpenMr: open });
    await user.type(input(), '!482{Enter}');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/session/mr-1/plan');
    });
    expect(open).toHaveBeenCalledWith(
      482,
      'mobile/mobile-app',
      expect.any(String),
      expect.any(Function),
    );
  });

  it('F-01.3 Start on a commit opens its step review; a branch opens a session', async () => {
    const user = userEvent.setup();
    const { router } = renderStart();
    await user.type(input(), '9be0d47');
    await user.click(screen.getByRole('button', { name: /^Start/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/session\/mock-session-\d+\/step$/);
    });
    await user.keyboard('{Control>}k{/Control}');
    // Ctrl+K focuses and selects the input once S-01 is mounted; typing earlier gets replaced.
    await waitFor(() => {
      expect(input()).toHaveFocus();
    });
    await user.keyboard('chore/compiled-bindings{Enter}');
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/session\/mock-session-\d+\/plan$/);
    });
  });

  it('F-01.4 Ctrl+K opens S-01 with the input focused from any screen', async () => {
    const user = userEvent.setup();
    const { router } = renderStart({}, {}, { screen: 'S-07', section: 'general' });
    await screen.findByRole('main', { name: 'Settings' });
    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => {
      expect(input()).toHaveFocus();
    });
    expect(router.state.location.pathname).toBe('/');
    input().blur();
    await user.keyboard('{Control>}k{/Control}');
    expect(input()).toHaveFocus();
  });

  it('F-01.5 unknown input shows the error under the input and stays on S-01', async () => {
    const user = userEvent.setup();
    const { router } = renderStart();
    await user.type(input(), 'nothing-like-this');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No commit, branch or repository matches “nothing-like-this”.',
    );
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/');
  });

  it('F-01.5 an MR that does not exist shows "No merge request !999 in …"', async () => {
    const user = userEvent.setup();
    const base = mockClient();
    const { router } = renderStart({ sessionOpenMr: (...args) => base.sessionOpenMr(...args) });
    await user.type(input(), '!999');
    await screen.findByText('Merge request !999');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No merge request !999 in mobile/mobile-app',
    );
    expect(router.state.location.pathname).toBe('/');
    await user.type(input(), '{Backspace}8');
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});

describe('S-01 Merge requests', () => {
  it('F-02.1 three tabs with counts; each shows its own list', async () => {
    const user = userEvent.setup();
    renderStart();
    const tabs = await column().findAllByRole('tab');
    await waitFor(() => {
      expect(tabs.map((t) => t.textContent)).toEqual(['Waiting for me 3', 'Mine 1', 'All open 12']);
    });
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(column().getByText('Crash when rotating the signature screen')).toBeInTheDocument();
    await user.click(column().getByRole('tab', { name: /^Mine/ }));
    expect(
      await column().findByText('Retry in UploadWorker after network loss'),
    ).toBeInTheDocument();
    expect(column().queryByText('Crash when rotating the signature screen')).toBeNull();
    expect(column().getByRole('tab', { name: /^Mine/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('F-02.1 shows 3 skeleton rows while loading and the empty copy per tab', async () => {
    const user = userEvent.setup();
    const pending: ((rows: MrRow[]) => void)[] = [];
    /** Answers the `n`th list call (1-based) with no rows, once it was made. */
    const answer = async (n: number) => {
      await waitFor(() => {
        expect(pending).toHaveLength(n);
      });
      pending[n - 1]?.([]);
    };
    const ipc = mockClient(quickMr);
    renderStart({
      gitlabListMrs: async (tab) => {
        const rows = await new Promise<MrRow[]>((r) => {
          pending.push(r);
        });
        const list = await ipc.gitlabListMrs(tab);
        return { ...list, rows };
      },
    });
    const busy = await column().findByLabelText('Loading merge requests');
    expect(busy.children).toHaveLength(3);
    await answer(1);
    expect(await column().findByText('Nothing waiting for you.')).toBeInTheDocument();
    await user.click(column().getByRole('tab', { name: /^Mine/ }));
    await answer(2);
    expect(await column().findByText('You have no open merge requests.')).toBeInTheDocument();
    await user.click(column().getByRole('tab', { name: /^All open/ }));
    await answer(3);
    expect(await column().findByText('No open merge requests.')).toBeInTheDocument();
  });

  it('F-02.1 without a token the column offers "Add your GitLab token"', async () => {
    const user = userEvent.setup();
    const { router } = renderStart({}, { gitlab: { state: 'noToken' } });
    const add = await column().findByRole('button', { name: 'Add your GitLab token' });
    expect(column().queryByRole('tablist')).toBeNull();
    await user.click(add);
    expect(router.state.location.pathname).toBe('/settings/gitlab');
  });

  it('F-02.2 a row shows iid, title, author · age, size, pipeline and note', async () => {
    renderStart();
    const title = await column().findByText('Migrate to .NET 10');
    const row = within(title.closest('button') ?? document.body);
    expect(row.getByText('!475')).toBeInTheDocument();
    expect(row.getByText('Kuba W. · 1 d')).toBeInTheDocument();
    expect(row.getByText('+1204')).toBeInTheDocument();
    expect(row.getByText('−987')).toBeInTheDocument();
    expect(row.getByText(/· 61 files/)).toBeInTheDocument();
    const pipeline = row.getByText('pipeline failed');
    expect(pipeline.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(row.getByText('Large: the plan splits it by layer')).toBeInTheDocument();
    const offline = column().getByText('Offline queue for delivery photos').closest('button');
    const fresh = within(offline ?? document.body);
    expect(fresh.getByText('Marta K. · 2 h')).toBeInTheDocument();
    expect(fresh.getByText('pipeline passed')).toBeInTheDocument();
  });

  it('F-02.2 my own MR shows "You" as the author', async () => {
    const user = userEvent.setup();
    renderStart();
    await user.click(await column().findByRole('tab', { name: /^Mine/ }));
    expect(await column().findByText('You · 1 d')).toBeInTheDocument();
    expect(column().getByText('2 unresolved threads from reviewers')).toBeInTheDocument();
  });

  it("F-02.3 a teammate's MR opens the plan, my own opens author mode", async () => {
    const user = userEvent.setup();
    const { router } = renderStart();
    await user.click(await column().findByText('Crash when rotating the signature screen'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/session/mr-1/plan');
    });
    await router.navigate('/');
    await screen.findByRole('region', { name: 'Merge requests' });
    await user.click(await column().findByRole('tab', { name: /^Mine/ }));
    await user.click(await column().findByText('Retry in UploadWorker after network loss'));
    expect(router.state.location.pathname).toBe('/mr/480/author');
  });

  it('F-02.2 ages use minutes, hours and days', async () => {
    const { age } = await import('./mrRow');
    const now = Date.parse('2026-10-12T12:00:00Z');
    const at = (ms: number) => new Date(now - ms).toISOString();
    expect(age(at(30_000), now)).toBe('1 min');
    expect(age(at(HOUR / 4), now)).toBe('15 min');
    expect(age(at(5 * HOUR), now)).toBe('5 h');
    expect(age(at(50 * HOUR), now)).toBe('2 d');
  });
});
