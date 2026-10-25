import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { renderApp } from '../../test/renderApp';

// F-26.3: S-10 **Fix in Rider** on a change thread (docs/plans/M7.md F-26.3, decision 7;
// Author.dc.html `fixRider`, `fBusy`, `fApplied`). The click opens the file at the thread's line
// (riderOpen(path, line), no session) and then watches that one file with fixWatch(path, onEvent);
// the card swaps its actions for the busy line "Opened UploadWorker.cs:46 in Rider. Waiting for
// your change…" and **Stop waiting**. The core's `{ kind: 'changed' }` event turns it into the
// green line "Change detected from Rider. Commit it below." (the commit panel is F-26.4).
// The watch ends on change, on Stop waiting, when another thread is picked and when S-10 is left.
//
// Locators the screen keeps:
//  - the card: <section role="region" aria-label="Thread">; "Fix in Rider" is a <button> in it.
//  - the busy line and the detected line: elements with role="status" holding exactly the copy
//    above (the file name alone, `:<line>`, as `Opened <name>:<line> in Rider. …`), inside the card.
//  - <button> "Stop waiting" in the card, next to the busy line.
//  - an error of riderOpen or fixWatch: role="alert" with the IpcError message, the card stays.
// Nothing else in the card changes: Fix with Claude and Reply are F-25.3 and F-26.5.

const PROJECT = 'mobile/mobile-app';
const IID = 480;
const PATH = 'src/App/Workers/UploadWorker.cs';
const BUSY = 'Opened UploadWorker.cs:46 in Rider. Waiting for your change…';
const DETECTED = 'Change detected from Rider. Commit it below.';

type FixWatch = IpcClient['fixWatch'];
type FixWatchEvent = Parameters<Parameters<FixWatch>[1]>[0];
type AuthorMr = Awaited<ReturnType<IpcClient['authorMr']>>;
type Thread = AuthorMr['threads'][number];

interface Watch {
  file: string;
  emit: (event: FixWatchEvent) => void;
  stop: ReturnType<typeof vi.fn<() => void>>;
}

async function backend(
  over: {
    threads?: (base: Thread[]) => Thread[];
    riderOpen?: IpcClient['riderOpen'];
    fixWatch?: FixWatch;
  } = {},
) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const mr = await base.authorMr(PROJECT, IID);
  const authorMr = vi.fn(() =>
    Promise.resolve({ ...mr, threads: over.threads ? over.threads(mr.threads) : mr.threads }),
  );
  const authorFileDiff = vi.fn(base.authorFileDiff.bind(base));
  const riderOpen = vi.fn(over.riderOpen ?? (() => Promise.resolve()));
  const watches: Watch[] = [];
  const fixWatch = vi.fn<FixWatch>(
    over.fixWatch ??
      ((file, onEvent) => {
        const stop = vi.fn<() => void>();
        watches.push({ file, emit: onEvent, stop });
        return Promise.resolve(stop);
      }),
  );
  return {
    client: { ...base, authorMr, authorFileDiff, riderOpen, fixWatch },
    authorFileDiff,
    riderOpen,
    fixWatch,
    watches,
  };
}

async function openAuthor(over?: Parameters<typeof backend>[0]) {
  const rec = await backend(over);
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));
  return { ...app, ...rec };
}

const card = () => screen.findByRole('region', { name: 'Thread' });
const fixInRider = async () => within(await card()).findByRole('button', { name: 'Fix in Rider' });
const watchOf = (watches: Watch[], index: number): Watch => {
  const found = watches[index];
  if (!found) throw new Error(`no watch ${String(index)}`);
  return found;
};
const option = (name: RegExp) => {
  const found = within(screen.getByRole('listbox', { name: 'Threads' }))
    .getAllByRole('option')
    .find((o) => name.test(o.textContent));
  if (!found) throw new Error(`no thread option ${String(name)}`);
  return found;
};
const statusWith = async (text: string) => {
  const line = await within(await card()).findByText(text);
  return line.closest('[role="status"]');
};

describe('S-10 Fix in Rider (F-26.3)', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so a virtual list renders its rows.
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

  it('F-26.3 Fix in Rider opens the file at the line, then watches that one file', async () => {
    const { riderOpen, fixWatch } = await openAuthor();

    await userEvent.click(await fixInRider());

    await waitFor(() => {
      expect(fixWatch).toHaveBeenCalledTimes(1);
    });
    expect(riderOpen).toHaveBeenCalledTimes(1);
    expect(riderOpen).toHaveBeenCalledWith(PATH, 46);
    expect(fixWatch.mock.calls[0]?.[0]).toBe(PATH);
    const opened = riderOpen.mock.invocationCallOrder[0] ?? Infinity;
    const watched = fixWatch.mock.invocationCallOrder[0] ?? -Infinity;
    expect(opened).toBeLessThan(watched);
  });

  it('F-26.3 the card shows the busy line and Stop waiting instead of the actions', async () => {
    await openAuthor();
    await userEvent.click(await fixInRider());

    const busy = await statusWith(BUSY);
    expect(busy).not.toBeNull();
    const thread = within(await card());
    expect(thread.getByRole('button', { name: 'Stop waiting' })).toBeEnabled();
    expect(thread.queryByRole('button', { name: 'Fix in Rider' })).toBeNull();
    expect(thread.queryByRole('button', { name: 'Fix with Claude' })).toBeNull();
    expect(thread.queryByRole('button', { name: 'Reply' })).toBeNull();
    // The conversation stays where it was.
    expect(thread.getByText('Marta K.')).toBeInTheDocument();
  });

  it('F-26.3 the file bar’s “Open in Rider · line 46” only opens the file, it does not watch', async () => {
    const { riderOpen, fixWatch } = await openAuthor();

    await userEvent.click(await screen.findByRole('button', { name: 'Open in Rider · line 46' }));

    await waitFor(() => {
      expect(riderOpen).toHaveBeenCalledWith(PATH, 46);
    });
    expect(fixWatch).not.toHaveBeenCalled();
    expect(within(await card()).queryByText(BUSY)).toBeNull();
    expect(within(await card()).getByRole('button', { name: 'Fix in Rider' })).toBeEnabled();
  });

  it('F-26.3 a detected change shows “Change detected from Rider. Commit it below.” and ends the waiting', async () => {
    const { watches } = await openAuthor();
    await userEvent.click(await fixInRider());
    await statusWith(BUSY);

    act(() => {
      watchOf(watches, 0).emit({ kind: 'changed' });
    });

    expect(await statusWith(DETECTED)).not.toBeNull();
    const thread = within(await card());
    expect(thread.queryByText(BUSY)).toBeNull();
    expect(thread.queryByRole('button', { name: 'Stop waiting' })).toBeNull();
    // The flow went on: nothing offers to open Rider for the same thread again.
    expect(thread.queryByRole('button', { name: 'Fix in Rider' })).toBeNull();
  });

  it('F-26.3 after a detected change the file’s diff is read again to show the edit', async () => {
    const { watches, authorFileDiff } = await openAuthor();
    await userEvent.click(await fixInRider());
    await statusWith(BUSY);
    await waitFor(() => {
      expect(authorFileDiff).toHaveBeenCalled();
    });
    const before = authorFileDiff.mock.calls.length;

    act(() => {
      watchOf(watches, 0).emit({ kind: 'changed' });
    });

    await waitFor(() => {
      expect(authorFileDiff.mock.calls.length).toBeGreaterThan(before);
    });
    expect(authorFileDiff).toHaveBeenLastCalledWith('develop', PATH);
  });

  it('F-26.3 Stop waiting ends the watch and brings the actions back; a late change is ignored', async () => {
    const { watches, fixWatch } = await openAuthor();
    await userEvent.click(await fixInRider());
    await statusWith(BUSY);

    await userEvent.click(within(await card()).getByRole('button', { name: 'Stop waiting' }));

    const watch = watchOf(watches, 0);
    expect(watch.stop).toHaveBeenCalledTimes(1);
    const thread = within(await card());
    expect(thread.queryByText(BUSY)).toBeNull();
    expect(thread.queryByRole('button', { name: 'Stop waiting' })).toBeNull();
    expect(thread.getByRole('button', { name: 'Fix with Claude' })).toBeEnabled();
    expect(thread.getByRole('button', { name: 'Fix in Rider' })).toBeEnabled();
    expect(thread.getByRole('button', { name: 'Reply' })).toBeEnabled();
    act(() => {
      watch.emit({ kind: 'changed' });
    });
    expect(thread.queryByText(DETECTED)).toBeNull();
    // Fix in Rider can be used again: a new watch.
    await userEvent.click(thread.getByRole('button', { name: 'Fix in Rider' }));
    await waitFor(() => {
      expect(fixWatch).toHaveBeenCalledTimes(2);
    });
    expect(await statusWith(BUSY)).not.toBeNull();
  });

  it('F-26.3 picking another thread ends the watch; coming back shows the actions again', async () => {
    const { watches } = await openAuthor();
    await userEvent.click(await fixInRider());
    await statusWith(BUSY);

    await userEvent.click(option(/Piotr S\./));
    await screen.findByRole('button', { name: 'Open in Rider · line 36' });
    expect(watchOf(watches, 0).stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(BUSY)).toBeNull();

    await userEvent.click(option(/Marta K\./));
    const thread = within(await card());
    await thread.findByRole('button', { name: 'Fix in Rider' });
    expect(thread.queryByText(BUSY)).toBeNull();
    expect(thread.queryByRole('button', { name: 'Stop waiting' })).toBeNull();
    // The ended watch cannot report a change any more.
    act(() => {
      watchOf(watches, 0).emit({ kind: 'changed' });
    });
    expect(screen.queryByText(DETECTED)).toBeNull();
  });

  it('F-26.3 leaving S-10 ends the watch', async () => {
    const { watches, router } = await openAuthor();
    await userEvent.click(await fixInRider());
    await statusWith(BUSY);

    await act(() => router.navigate(pathFor({ screen: 'S-01' })));

    await waitFor(() => {
      expect(watchOf(watches, 0).stop).toHaveBeenCalledTimes(1);
    });
  });

  it('F-26.3 Rider that cannot be opened shows the error, starts no watch and keeps the actions', async () => {
    const { fixWatch } = await openAuthor({
      riderOpen: () =>
        Promise.reject(
          new IpcError({
            code: 'INVALID_INPUT',
            message: 'Rider could not be started.',
            retryable: false,
          }),
        ),
    });

    await userEvent.click(await fixInRider());

    expect(await screen.findByRole('alert')).toHaveTextContent('Rider could not be started.');
    expect(fixWatch).not.toHaveBeenCalled();
    const thread = within(await card());
    expect(thread.queryByText(BUSY)).toBeNull();
    expect(thread.getByRole('button', { name: 'Fix in Rider' })).toBeEnabled();
  });

  it('F-26.3 a watch that cannot start shows the error and brings the actions back', async () => {
    await openAuthor({
      fixWatch: () =>
        Promise.reject(
          new IpcError({
            code: 'INTERNAL',
            message: 'The working tree can’t be watched.',
            retryable: false,
          }),
        ),
    });

    await userEvent.click(await fixInRider());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The working tree can’t be watched.',
    );
    const thread = within(await card());
    expect(thread.queryByText(BUSY)).toBeNull();
    expect(thread.queryByRole('button', { name: 'Stop waiting' })).toBeNull();
    expect(thread.getByRole('button', { name: 'Fix in Rider' })).toBeEnabled();
  });

  it('F-26.3 a thread without a line is opened and named at line 1, as Rider opens it', async () => {
    const { riderOpen, fixWatch } = await openAuthor({
      threads: (all) => all.map((t, i) => (i === 0 ? { ...t, line: null } : t)),
    });

    await userEvent.click(await fixInRider());

    expect(
      await statusWith('Opened UploadWorker.cs:1 in Rider. Waiting for your change…'),
    ).not.toBeNull();
    expect(riderOpen).toHaveBeenCalledWith(PATH, 1);
    expect(fixWatch.mock.calls[0]?.[0]).toBe(PATH);
  });
});
