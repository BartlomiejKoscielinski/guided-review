import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IpcClient } from '../../ipc/client';
import type { MockOptions } from '../../ipc/mock';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

function renderStart(overrides: Partial<IpcClient> = {}, options: MockOptions = {}) {
  const ipc = mockClient(overrides, options);
  return { ipc, ...renderApp({ screen: 'S-01' }, ipc) };
}

/** Unchanged mock commands, wrapped by `vi.fn` to see the calls. */
const base = mockClient();

const commits = () => within(screen.getByRole('region', { name: 'Commits' }));
const mine = () => within(screen.getByRole('region', { name: 'My changes' }));
const rows = () => commits().findAllByRole('option');

async function shiftClick(user: ReturnType<typeof userEvent.setup>, element: HTMLElement) {
  await user.keyboard('{Shift>}');
  await user.click(element);
  await user.keyboard('{/Shift}');
}

describe('S-01 Commits', () => {
  it('F-03.1 lists the current branch newest first with SHA, subject, author · age', async () => {
    renderStart();
    const list = await rows();
    expect(list).toHaveLength(5);
    expect(commits().getByText('chore/compiled-bindings')).toBeInTheDocument();
    expect(list[0]).toHaveTextContent('a3f9c12UploadWorker: jittered backoffMarta K. · 2 h');
    expect(list[2]).toHaveTextContent('51c2e8aFix: double tap in SendPhotoYou · yesterday');
    expect(list[4]).toHaveTextContent('c4a19b0Strings.resx: offline messagesMarta K. · 2 d');
  });

  it('F-03.1 the search filters by message, author or SHA', async () => {
    const user = userEvent.setup();
    const gitLog = vi.fn<IpcClient['gitLog']>((branch, query) => base.gitLog(branch, query));
    renderStart({ gitLog });
    await rows();
    const search = commits().getByRole('textbox', { name: 'Search commits' });
    expect(search).toHaveAttribute('placeholder', 'Message, author or SHA');
    await user.type(search, 'offline');
    await waitFor(() => {
      expect(commits().getAllByRole('option')).toHaveLength(2);
    });
    expect(gitLog).toHaveBeenLastCalledWith(undefined, 'offline');
    await user.clear(search);
    await user.type(search, 'Paweł');
    await waitFor(() => {
      expect(commits().getAllByRole('option')).toHaveLength(1);
    });
    await user.clear(search);
    await user.type(search, '51c2e8a');
    await waitFor(() => {
      expect(commits().getByRole('option')).toHaveTextContent('Fix: double tap in SendPhoto');
    });
  });

  it('F-03.1 a search without matches shows "No commits match."', async () => {
    const user = userEvent.setup();
    renderStart();
    await rows();
    await user.type(commits().getByRole('textbox', { name: 'Search commits' }), 'zzz-nothing');
    expect(await commits().findByText('No commits match.')).toBeInTheDocument();
    expect(commits().queryAllByRole('option')).toHaveLength(0);
  });

  it('F-03.2 a click selects one commit, Shift+click a range', async () => {
    const user = userEvent.setup();
    renderStart();
    const list = await rows();
    expect(list[0]).toHaveAttribute('aria-selected', 'true');
    expect(commits().getByRole('button', { name: 'Review a3f9c12' })).toBeEnabled();
    await user.click(list[2] as HTMLElement);
    expect(list[0]).toHaveAttribute('aria-selected', 'false');
    expect(commits().getByRole('button', { name: 'Review 51c2e8a' })).toBeEnabled();
    await shiftClick(user, list[4] as HTMLElement);
    const selected = list.map((row) => row.getAttribute('aria-selected'));
    expect(selected).toEqual(['false', 'false', 'true', 'true', 'true']);
    expect(commits().getByRole('button', { name: 'Review c4a19b0..51c2e8a' })).toBeEnabled();
    expect(commits().getByRole('button', { name: 'Browse files' })).toBeDisabled();
    expect(commits().getByText('Shift + click selects a range.')).toBeInTheDocument();
  });

  it('F-03.2 Review opens the range with its oldest commit included', async () => {
    const user = userEvent.setup();
    const sessionOpenCommit = vi.fn<IpcClient['sessionOpenCommit']>((range) =>
      base.sessionOpenCommit(range),
    );
    const { router } = renderStart({ sessionOpenCommit });
    const list = await rows();
    await shiftClick(user, list[1] as HTMLElement);
    await user.click(commits().getByRole('button', { name: 'Review 9be0d47..a3f9c12' }));
    expect(sessionOpenCommit).toHaveBeenCalledWith({
      from: '51c2e8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6',
      to: 'a3f9c12b7e4d6f8091a2b3c4d5e6f708192a3b4c',
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/session\/mock-session-\d+\/step$/);
    });
  });

  it('F-03.2 Review of one commit and Browse files (S-06 commit mode)', async () => {
    const user = userEvent.setup();
    const sessionOpenCommit = vi.fn<IpcClient['sessionOpenCommit']>((range) =>
      base.sessionOpenCommit(range),
    );
    const { router } = renderStart({ sessionOpenCommit });
    const list = await rows();
    await user.click(list[1] as HTMLElement);
    await user.click(commits().getByRole('button', { name: 'Browse files' }));
    expect(router.state.location.pathname).toBe(
      '/changes/commit/9be0d47c2a1f3e5b6d7c8e9f0a1b2c3d4e5f6a7b',
    );
    await router.navigate('/');
    await screen.findByRole('region', { name: 'Commits' });
    await user.click(await commits().findByRole('button', { name: 'Review a3f9c12' }));
    expect(sessionOpenCommit).toHaveBeenCalledWith({
      to: 'a3f9c12b7e4d6f8091a2b3c4d5e6f708192a3b4c',
    });
  });
});

describe('S-01 My changes', () => {
  it('F-03.3 the current branch and three scopes as radio cards with counts', async () => {
    renderStart();
    expect(await mine().findAllByRole('radio')).toHaveLength(3);
    expect(mine().getByText('chore/compiled-bindings')).toBeInTheDocument();
    expect(mine().getByRole('radio', { name: /Uncommitted changes/ })).toBeChecked();
    expect(mine().getByText('100 files · +318 −142')).toBeInTheDocument();
    expect(mine().getByRole('radio', { name: /Staged only/ })).not.toBeChecked();
    expect(mine().getByText('12 files · +41 −9')).toBeInTheDocument();
    expect(mine().getByRole('radio', { name: /Whole branch vs develop/ })).toBeInTheDocument();
    expect(mine().getByText('3 commits · 104 files')).toBeInTheDocument();
  });

  it('F-03.3 without a target the whole-branch scope is left out', async () => {
    renderStart({
      gitStatusSummary: () =>
        Promise.resolve({
          branch: 'main',
          uncommitted: { files: 1, additions: 2, deletions: 0 },
          staged: { files: 0, additions: 0, deletions: 0 },
        }),
    });
    expect(await mine().findAllByRole('radio')).toHaveLength(2);
    expect(mine().getByText('1 file · +2 −0')).toBeInTheDocument();
  });

  it('F-03.4 Review before push opens a self-review of the chosen scope', async () => {
    const user = userEvent.setup();
    const sessionOpenLocal = vi.fn<IpcClient['sessionOpenLocal']>((scope) =>
      base.sessionOpenLocal(scope),
    );
    const { router } = renderStart({ sessionOpenLocal });
    await user.click(await mine().findByRole('radio', { name: /Whole branch vs develop/ }));
    await user.click(mine().getByRole('button', { name: 'Review before push' }));
    expect(sessionOpenLocal).toHaveBeenCalledWith({
      kind: 'branchVsTarget',
      target: 'origin/develop',
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/session\/mock-session-\d+\/plan$/);
    });
  });

  it('F-03.4 the self-review sentence and Browse and commit (S-06 local mode)', async () => {
    const user = userEvent.setup();
    const { router } = renderStart();
    expect(
      await mine().findByText(
        'Self-review never publishes anything. You end with a list of fixes before pushing and a draft MR description.',
      ),
    ).toBeInTheDocument();
    await user.click(mine().getByRole('button', { name: 'Browse and commit' }));
    expect(router.state.location.pathname).toBe('/changes');
  });

  it('F-03.4 without a repository the column offers "Pick a repository"', async () => {
    const user = userEvent.setup();
    const repoPick = vi.fn(() => Promise.resolve(null));
    renderStart({ repoPick }, { changes: { noRepo: true } });
    await user.click(await mine().findByRole('button', { name: 'Pick a repository' }));
    expect(repoPick).toHaveBeenCalled();
    expect(mine().queryByRole('button', { name: 'Review before push' })).toBeNull();
    expect(await commits().findByText('Pick a repository first.')).toBeInTheDocument();
  });
});
