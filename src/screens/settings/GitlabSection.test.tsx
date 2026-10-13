import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../app/queryClient';
import { IpcProvider } from '../../ipc/IpcProvider';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';
import { GitlabSection } from './GitlabSection';
import { expiryText, gitlabStatusText } from './gitlabText';

/** Synthetic, shorter than a real token (push protection). */
const TOKEN = 'glpat-test0000fake3f9b';

/** The `index`th repository row. */
function repoRow(index: number): HTMLElement {
  const row = screen.getAllByRole('listitem')[index];
  if (!row) throw new Error(`no repository row ${String(index)}`);
  return row;
}

describe('Settings › GitLab', () => {
  it('F-19.2 server, user, masked token, scope, expiry and repositories', async () => {
    renderApp({ screen: 'S-07', section: 'gitlab' }, mockClient());
    expect(await screen.findByText('Signed in as bartek.k on gitlab.local')).toBeInTheDocument();
    expect(screen.getByText('https://gitlab.local')).toBeInTheDocument();
    expect(screen.getByText('glpat-…3f9a')).toBeInTheDocument();
    expect(
      screen.getByText('scope api · expires in 41 days · stored in Windows Credential Manager'),
    ).toBeInTheDocument();
    await screen.findAllByRole('listitem');
    expect(within(repoRow(0)).getByText('mobile/mobile-app')).toBeInTheDocument();
    expect(
      within(repoRow(0)).getByText('C:\\src\\mobile-app · review worktrees in C:\\src\\.review'),
    ).toBeInTheDocument();
    expect(within(repoRow(0)).getByText('Default')).toBeInTheDocument();
    expect(within(repoRow(1)).queryByText('Default')).toBeNull();

    const today = new Date(2026, 9, 12);
    expect(expiryText('2026-11-22', today)).toBe('expires in 41 days');
    expect(expiryText('2026-10-13', today)).toBe('expires in 1 day');
    expect(expiryText('2026-10-12', today)).toBe('expires today');
    expect(expiryText('2026-10-11', today)).toBe('expired');
    expect(expiryText(null, today)).toBe('no expiry');
  });

  it('F-19.5 Check and save, Replace token, Remove; the token never stays in UI state', async () => {
    const user = userEvent.setup();
    const ipc = mockClient({}, { gitlab: { state: 'noToken' } });
    const save = vi.spyOn(ipc, 'gitlabAccountSave');
    const queryClient = createQueryClient();
    render(
      <IpcProvider client={ipc}>
        <QueryClientProvider client={queryClient}>
          <GitlabSection />
        </QueryClientProvider>
      </IpcProvider>,
    );
    expect(await screen.findByText('Add your GitLab token')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await user.clear(screen.getByLabelText('Server URL'));
    await user.type(screen.getByLabelText('Server URL'), 'https://gitlab.test/');
    await user.type(screen.getByLabelText('Access token'), TOKEN);
    await user.click(screen.getByRole('button', { name: 'Check and save' }));

    expect(await screen.findByText('Signed in as bartek.k on gitlab.test')).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith('https://gitlab.test/', TOKEN);
    expect(screen.getByText('glpat-…3f9b')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state),
      ),
    ).not.toContain(TOKEN);
    await waitFor(() => {
      const mutations = queryClient.getMutationCache().getAll();
      expect(JSON.stringify(mutations.map((m) => m.state))).not.toContain(TOKEN);
    });

    await user.click(screen.getByRole('button', { name: 'Replace token' }));
    expect(screen.getByLabelText('Server URL')).toHaveValue('https://gitlab.test');
    expect(screen.getByLabelText('Access token')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('glpat-…3f9b')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Add your GitLab token')).toBeInTheDocument();
    expect(screen.getByLabelText('Access token')).toHaveValue('');
  });

  it('F-19.5 a rejected token shows the core message', async () => {
    const user = userEvent.setup();
    renderApp(
      { screen: 'S-07', section: 'gitlab' },
      mockClient({}, { gitlab: { state: 'noToken' } }),
    );
    await user.click(await screen.findByRole('button', { name: 'Check and save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Paste the whole personal access token.',
    );
    expect(
      gitlabStatusText({
        state: 'failing',
        server: 'https://gitlab.local',
        user: null,
        tokenMasked: 'glpat-…3f9a',
        scopes: [],
        expiresAt: null,
        problem: {
          code: 'GITLAB_UNAUTHORIZED',
          message: 'The token has expired.',
          retryable: false,
        },
      }),
    ).toBe('The token has expired.');
  });

  it('F-19.6 add, set as default and remove repositories', async () => {
    const user = userEvent.setup();
    const ipc = mockClient();
    const setDefault = vi.spyOn(ipc, 'repoSetDefault');
    const remove = vi.spyOn(ipc, 'repoRemove');
    renderApp({ screen: 'S-07', section: 'gitlab' }, ipc);
    await user.click(await screen.findByRole('button', { name: 'Set courier-api as default' }));
    expect(setDefault).toHaveBeenCalledWith(2);
    await waitFor(() => {
      expect(within(repoRow(1)).getByText('Default')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Remove mobile-app' }));
    expect(remove).toHaveBeenCalledWith(1);
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });
  });

  it('F-19.6 Add repository uses the folder dialog; the first one is the default', async () => {
    const user = userEvent.setup();
    const ipc = mockClient({}, { changes: { noRepo: true } });
    const pick = vi.spyOn(ipc, 'repoPick');
    renderApp({ screen: 'S-07', section: 'gitlab' }, ipc);
    expect(await screen.findByText('Signed in as bartek.k on gitlab.local')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Add repository' }));
    expect(pick).toHaveBeenCalled();
    const row = await screen.findByRole('listitem');
    expect(within(row).getByText('mobile/mobile-app')).toBeInTheDocument();
    expect(within(row).getByText('Default')).toBeInTheDocument();
  });
});
