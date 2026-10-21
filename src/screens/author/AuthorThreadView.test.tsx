import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import type { FileDiff } from '../../ipc/types/FileDiff';
import { renderApp } from '../../test/renderApp';

// F-26.2: S-10 Your MR, main column (Author.dc.html, M7 decision 6). The selected thread opens in
// the code at its line: a sticky file bar (path, "Open in Rider · line N"), the file's unified
// diff from `authorFileDiff(targetBranch, path)`, and the thread card under the row of the
// thread's line with the conversation and, on a change thread, "Fix with Claude", "Fix in
// Rider", "Reply". A General thread has no file: its conversation only. Against the mock
// backend's !480 (Marta K. UploadWorker.cs:46 change request, Piotr S. UploadWorker.cs:36
// question) and against replaced `authorMr` / `authorFileDiff` answers for the rest.
//
// Locators the screen keeps:
//  - the file bar: the path with the file name alone in a <b> ("src/App/Workers/" then
//    <b>UploadWorker.cs</b>) and a <button> named "Open in Rider · line 46" (the case of the text;
//    CSS uppercases); absent on a General thread. A click calls riderOpen(path, line) with two
//    arguments (no session).
//  - the code: DiffView rows, `[data-kind="add" | "del" | "ctx"]` holding `[data-line-no]`.
//  - the card: <section role="region" aria-label="Thread"> placed after the row of the thread's
//    line and before the next row. In it, per note in order: an avatar square with the initials,
//    the author (my own note reads "You"), the age ("3 h ago") as separate elements, and the text.
//    Only the selected thread has a card.
//  - the actions: <button> "Fix with Claude", "Fix in Rider", "Reply" inside the card.
//  - a failed read of the diff: role="alert" with the error message; the card stays.

const PROJECT = 'mobile/mobile-app';
const IID = 480;
const PATH = 'src/App/Workers/UploadWorker.cs';
const MARTA = 'The delay grows linearly. Can we make it exponential with a cap?';
const PIOTR = 'What happens if the app is killed in the middle of retrying?';

type AuthorMr = Awaited<ReturnType<IpcClient['authorMr']>>;
type Thread = AuthorMr['threads'][number];

const never = () => new Promise<FileDiff>(() => undefined);

/** The mock's !480 with replaced answers; `diff` replaces the file read, `threads` the list. */
async function backend(
  over: {
    threads?: (base: Thread[]) => Thread[];
    diff?: (target: string, path: string) => Promise<FileDiff>;
  } = {},
) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const mr = await base.authorMr(PROJECT, IID);
  const authorMr = vi.fn(() =>
    Promise.resolve({ ...mr, threads: over.threads ? over.threads(mr.threads) : mr.threads }),
  );
  const authorFileDiff = vi.fn(over.diff ?? base.authorFileDiff.bind(base));
  const riderOpen = vi.fn(() => Promise.resolve());
  return { client: { ...base, authorMr, authorFileDiff, riderOpen }, authorFileDiff, riderOpen };
}

async function openAuthor(over?: Parameters<typeof backend>[0]) {
  const rec = await backend(over);
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));
  return { ...app, ...rec };
}

const card = () => screen.findByRole('region', { name: 'Thread' });
const option = (name: RegExp) => {
  const found = within(screen.getByRole('listbox', { name: 'Threads' }))
    .getAllByRole('option')
    .find((o) => name.test(o.textContent));
  if (!found) throw new Error(`no thread option ${String(name)}`);
  return found;
};

/** The diff row of a kind and line number (new number for add and ctx, old for del). */
const row = (kind: 'add' | 'del' | 'ctx', no: number) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[data-kind="${kind}"]`)).find((r) =>
    r.querySelector(`[data-line-no="${String(no)}"]`),
  );
const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
/** True when `later` comes after `earlier` in the document. */
const after = (earlier: Node, later: Node) =>
  (earlier.compareDocumentPosition(later) & FOLLOWING) !== 0;

const emptyDiff = (): FileDiff => ({
  status: 'modified',
  binary: false,
  additions: 0,
  deletions: 0,
  layer: 'app',
  lineStaging: false,
  hunks: [],
});

describe('S-10 thread in the code (F-26.2)', () => {
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

  it('F-26.2 the first thread opens in its file: the bar shows the path and “Open in Rider · line 46”', async () => {
    const { authorFileDiff } = await openAuthor();

    const open = await screen.findByRole('button', { name: 'Open in Rider · line 46' });
    expect(open).toBeInTheDocument();
    const name = screen.getByText('UploadWorker.cs', { selector: 'b' });
    expect(name.parentElement).toHaveTextContent(PATH);
    // The file read is the thread's file against the MR's target branch.
    await waitFor(() => {
      expect(authorFileDiff).toHaveBeenCalledWith('develop', PATH);
    });
  });

  it('F-26.2 the code is the file’s unified diff with the removed and added lines around the thread', async () => {
    await openAuthor();
    await card();

    expect(row('del', 36)).toHaveTextContent('await _api.UploadPhotoAsync(item.DeliveryId');
    expect(row('add', 36)).toHaveTextContent('var attempt = 0;');
    expect(row('add', 46)).toHaveTextContent('await Task.Delay(1000 * attempt, ct);');
    expect(row('ctx', 49)).toHaveTextContent('await _queue.RemoveAsync(item.Id, ct);');
  });

  it('F-26.2 the thread card sits right under the row of the thread’s line with the conversation', async () => {
    await openAuthor();

    const thread = await card();
    const line = row('add', 46);
    const next = row('add', 47);
    if (!line || !next) throw new Error('the diff rows around line 46 are missing');
    expect(after(line, thread)).toBe(true);
    expect(after(thread, next)).toBe(true);
    expect(within(thread).getByText('Marta K.')).toBeInTheDocument();
    expect(within(thread).getByText('MK')).toBeInTheDocument();
    expect(within(thread).getByText('3 h ago')).toBeInTheDocument();
    expect(within(thread).getByText(new RegExp(MARTA))).toBeInTheDocument();
  });

  it('F-26.2 a change thread offers Fix with Claude, Fix in Rider and Reply', async () => {
    await openAuthor();

    const thread = within(await card());
    expect(thread.getByRole('button', { name: 'Fix with Claude' })).toBeEnabled();
    expect(thread.getByRole('button', { name: 'Fix in Rider' })).toBeEnabled();
    expect(thread.getByRole('button', { name: 'Reply' })).toBeEnabled();
  });

  it('F-26.2 “Open in Rider · line 46” opens the thread’s file at its line', async () => {
    const { riderOpen } = await openAuthor();

    await userEvent.click(await screen.findByRole('button', { name: 'Open in Rider · line 46' }));

    expect(riderOpen).toHaveBeenCalledTimes(1);
    expect(riderOpen).toHaveBeenCalledWith(PATH, 46);
  });

  it('F-26.2 picking Piotr’s question moves the bar, the code anchor and the card to line 36, without the fix actions', async () => {
    await openAuthor();
    await card();

    await userEvent.click(option(/Piotr S\./));

    expect(
      await screen.findByRole('button', { name: 'Open in Rider · line 36' }),
    ).toBeInTheDocument();
    const thread = await screen.findByText(new RegExp(PIOTR));
    const region = screen.getByRole('region', { name: 'Thread' });
    expect(region).toContainElement(thread);
    expect(within(region).queryByText(new RegExp(MARTA))).toBeNull();
    const line = row('add', 36);
    const next = row('add', 37);
    if (!line || !next) throw new Error('the diff rows around line 36 are missing');
    expect(after(line, region)).toBe(true);
    expect(after(region, next)).toBe(true);
    // A question is answered with a reply (F-26.7), not fixed: no Fix actions here.
    expect(within(region).queryByRole('button', { name: 'Fix with Claude' })).toBeNull();
    expect(within(region).queryByRole('button', { name: 'Fix in Rider' })).toBeNull();
    expect(screen.getAllByRole('region', { name: 'Thread' })).toHaveLength(1);
  });

  it('F-26.2 a thread in another file reads that file and opens it in Rider at its line', async () => {
    const other = 'src/App/Zażółć/Other File.cs';
    const { authorFileDiff, riderOpen } = await openAuthor({
      threads: (all) => {
        const [first, second] = all;
        if (!first || !second) throw new Error('the mock has two threads');
        return [first, { ...second, path: other, line: 12, place: 'Other File.cs:12' }];
      },
    });
    await card();

    await userEvent.click(option(/Piotr S\./));
    await userEvent.click(await screen.findByRole('button', { name: 'Open in Rider · line 12' }));

    expect(authorFileDiff).toHaveBeenCalledWith('develop', other);
    expect(riderOpen).toHaveBeenCalledWith(other, 12);
    expect(screen.getByText('Other File.cs', { selector: 'b' }).parentElement).toHaveTextContent(
      other,
    );
  });

  it('F-26.2 a General thread shows its conversation without a file bar or code', async () => {
    const { authorFileDiff } = await openAuthor({
      threads: (all) => {
        const [first] = all;
        if (!first) throw new Error('the mock has threads');
        return [
          {
            ...first,
            place: 'General',
            path: null,
            line: null,
            notes: [
              {
                author: 'Marta K.',
                avatar: 'MK',
                body: 'Overall this looks fine, please add a short note to the changelog.',
                createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
                mine: false,
              },
            ],
          },
        ];
      },
    });

    const thread = within(await card());
    expect(thread.getByText(/please add a short note to the changelog/)).toBeInTheDocument();
    expect(thread.getByText('Marta K.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Open in Rider/ })).toBeNull();
    expect(document.querySelector('[data-kind]')).toBeNull();
    expect(authorFileDiff).not.toHaveBeenCalled();
    // No file to edit: no Fix actions, but the thread can still be answered.
    expect(thread.queryByRole('button', { name: 'Fix with Claude' })).toBeNull();
    expect(thread.queryByRole('button', { name: 'Fix in Rider' })).toBeNull();
    expect(thread.getByRole('button', { name: 'Reply' })).toBeEnabled();
  });

  it('F-26.2 my own note reads “You”, after the reviewer’s, with its own age', async () => {
    await openAuthor({
      threads: (all) => {
        const [first] = all;
        if (!first) throw new Error('the mock has threads');
        return [
          {
            ...first,
            notes: [
              {
                author: 'Marta K.',
                avatar: 'MK',
                body: 'Please rename this.',
                createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
                mine: false,
              },
              {
                author: 'Bartek K.',
                avatar: 'BK',
                body: 'Renamed in the next commit.',
                createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
                mine: true,
              },
            ],
          },
        ];
      },
    });

    const thread = within(await card());
    expect(thread.getByText('You')).toBeInTheDocument();
    expect(thread.queryByText('Bartek K.')).toBeNull();
    expect(thread.getByText('BK')).toBeInTheDocument();
    expect(thread.getByText('2 h ago')).toBeInTheDocument();
    const text = (await card()).textContent;
    expect(text.indexOf('Renamed in the next commit.')).toBeGreaterThan(
      text.indexOf('Please rename this.'),
    );
  });

  it('F-26.2 while the file is read the conversation and its actions are already there', async () => {
    await openAuthor({ diff: never });

    const thread = within(await card());
    expect(thread.getByText(new RegExp(MARTA))).toBeInTheDocument();
    expect(thread.getByRole('button', { name: 'Reply' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open in Rider · line 46' })).toBeInTheDocument();
  });

  it('F-26.2 a failed read of the file says so and keeps the conversation', async () => {
    await openAuthor({
      diff: () =>
        Promise.reject(
          new IpcError({
            code: 'GIT_FAILED',
            message: 'Git could not read the file.',
            retryable: false,
          }),
        ),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Git could not read the file.');
    const thread = within(await card());
    expect(thread.getByText(new RegExp(MARTA))).toBeInTheDocument();
    expect(thread.getByRole('button', { name: 'Reply' })).toBeEnabled();
  });

  it('F-26.2 a file the author did not change shows the bar and the card without code', async () => {
    await openAuthor({ diff: () => Promise.resolve(emptyDiff()) });

    const thread = within(await card());
    expect(thread.getByText(new RegExp(MARTA))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open in Rider · line 46' })).toBeInTheDocument();
    expect(document.querySelector('[data-kind]')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
