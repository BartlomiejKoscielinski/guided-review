import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import { renderApp } from '../../test/renderApp';
import { initialsOf, keepPushed } from './pushedThreads';

// F-26.6 beyond the panel, as Author.dc.html {"fix":"pushed"} shows it (`fDone`, `msgs`,
// `pipeLabel`): the thread card ends with my reply ("You", the reply sent) and no actions or
// Rider line; with Resolve on a "Resolved" block. Once the new pipeline is found the title bar's
// chip reads it ("Pipeline running").

const IID = 480;
const COMMITTED = { sha: '9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40', shortSha: '9e1d4b7' };
const REPLY = 'Fixed in 9e1d4b7. Address review on UploadWorker.cs:46.';
type FixWatch = IpcClient['fixWatch'];
type FixWatchEvent = Parameters<Parameters<FixWatch>[1]>[0];

async function pushedApp(
  resolve: boolean,
  lookup?: IpcClient['authorPushPipeline'],
  push?: IpcClient['authorPushAndReply'],
) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const emits: ((event: FixWatchEvent) => void)[] = [];
  const client: IpcClient = {
    ...base,
    fixWatch: (_file, onEvent) => {
      emits.push(onEvent);
      return Promise.resolve(() => undefined);
    },
    gitCommit: () => Promise.resolve(COMMITTED),
    authorPushPipeline: lookup ?? base.authorPushPipeline,
    authorPushAndReply: push ?? base.authorPushAndReply,
  };
  const app = renderApp({ screen: 'S-01' }, client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));
  const card = await screen.findByRole('region', { name: 'Thread' });
  await userEvent.click(within(card).getByRole('button', { name: 'Fix in Rider' }));
  await waitFor(() => {
    expect(emits).toHaveLength(1);
  });
  act(() => {
    emits[0]?.({ kind: 'changed' });
  });
  const panel = await screen.findByRole('region', { name: 'Commit and push' });
  await userEvent.click(within(panel).getByRole('button', { name: 'Commit' }));
  await within(panel).findByText('not pushed yet');
  const region = within(screen.getByRole('region', { name: 'Commit and push' }));
  if (!resolve) await userEvent.click(region.getByRole('checkbox', { name: 'Resolve the thread' }));
  await userEvent.click(region.getByRole('button', { name: 'Push and reply' }));
  await region.findByText('Pushed');
  return within(screen.getByRole('region', { name: 'Thread' }));
}

describe('S-10 thread card after Push and reply (F-26.6)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('F-26.6 with Resolve on the card ends with my reply and reads Resolved, without actions', async () => {
    const card = await pushedApp(true, () => Promise.resolve(null));

    expect(card.getByText('You')).toBeInTheDocument();
    expect(card.getByText(REPLY)).toBeInTheDocument();
    expect(card.getByText('Resolved')).toBeInTheDocument();
    expect(card.queryByText('Change detected from Rider. Commit it below.')).toBeNull();
    expect(card.queryByRole('button', { name: 'Fix in Rider' })).toBeNull();
    expect(card.queryByRole('button', { name: 'Reply' })).toBeNull();
  });

  it('F-26.6 with Resolve off the card ends with my reply once, without Resolved', async () => {
    const card = await pushedApp(false, () => Promise.resolve(null));

    await waitFor(() => {
      expect(card.getAllByText(REPLY)).toHaveLength(1);
    });
    expect(card.queryByText('Resolved')).toBeNull();
    expect(card.queryByText('Change detected from Rider. Commit it below.')).toBeNull();
  });

  it('F-26.6 once the new pipeline is found the title bar chip reads it: “Pipeline running”', async () => {
    await pushedApp(true);

    const bar = within(screen.getByTestId('title-bar'));
    expect(bar.getByRole('link', { name: 'Pipeline passed' })).toBeInTheDocument();
    await waitFor(
      () => {
        expect(bar.getByRole('link', { name: 'Pipeline running' })).toBeInTheDocument();
      },
      { timeout: 10_000 },
    );
  }, 20_000);

  it('F-26.6 the pipeline is looked up for the pushed remote tip, a later commit on top of the fix', async () => {
    const later = 'c6349f001bd5b8a43e2e53df6b1a2dd67fc5b851';
    const lookup = vi.fn<IpcClient['authorPushPipeline']>().mockResolvedValue(null);
    await pushedApp(true, lookup, () =>
      Promise.resolve({
        kind: 'done',
        remoteBranch: 'origin/feature/upload-retry',
        resolved: true,
        pushedSha: later,
      }),
    );

    await waitFor(() => {
      expect(lookup).toHaveBeenCalledWith(expect.any(String), IID, later);
    });
    expect(lookup).not.toHaveBeenCalledWith(expect.any(String), IID, COMMITTED.sha);
  });

  it('F-26.6 my reply note carries my initials', () => {
    expect(initialsOf('Bartek K.')).toBe('BK');
    expect(initialsOf('')).toBe('');
  });

  it('F-26.6 only a thread resolved by a push in this visit is kept when GitLab drops it', () => {
    const t = (id: string) => ({
      id,
      author: 'Marta K.',
      avatar: 'MK',
      place: 'General',
      path: null,
      line: null,
      oldLine: null,
      excerpt: id,
      kind: 'change' as const,
      status: 'changeRequested' as const,
      notes: [],
    });
    const draft = (push: 'done' | 'failed', resolve: boolean) => ({
      message: '',
      fixup: true,
      committed: COMMITTED,
      reply: REPLY,
      resolve,
      replyId: null,
      push,
      pushedAt: null,
      pushedSha: null,
      pushError: null,
    });
    const before = [t('a'), t('b'), t('c')];

    expect(keepPushed(before, [t('c')], { b: draft('done', true) }).map((x) => x.id)).toEqual([
      'b',
      'c',
    ]);
    expect(keepPushed(before, [t('c')], { b: draft('done', false) }).map((x) => x.id)).toEqual([
      'c',
    ]);
    expect(keepPushed(before, [t('c')], { b: draft('failed', true) }).map((x) => x.id)).toEqual([
      'c',
    ]);
  });
});
