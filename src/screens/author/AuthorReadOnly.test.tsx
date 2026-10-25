import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { WaitingReply } from '../../ipc/types/WaitingReply';
import { useAuthorCommitStore } from '../../state/authorCommit';
import { renderApp } from '../../test/renderApp';

// F-26.8: S-10 while the user's checkout is not on the MR's source branch (the core's
// `AuthorMr.onSourceBranch` is false: another branch, a detached HEAD or a checkout git can't
// read). Author mode is read-only (M7 decisions 10 and 14, plan M7 F-26.8): a notice "Check out
// <branch> to fix here. The app never switches your branch." with the MR's source branch, and
// **Open in Rider** (the file bar's button of a thread on a file); Fix (Fix with Claude and Fix in
// Rider), Commit and Push (the commit panel, **Push and reply**) are hidden. Reply, Draft with
// Claude and Send reply stay: answering needs no checkout. Against the mock backend's !480 with
// `onSourceBranch` replaced.
//
// Locators the screen keeps:
//  - the notice is ONE element whose own text is the whole sentence, once per screen (not once
//    per thread or per card), shown whenever a thread is selected and the checkout is read-only;
//    absent when `onSourceBranch` is true.
//  - the card <section role="region" aria-label="Thread"> with buttons "Fix with Claude", "Fix in
//    Rider", "Reply"; the question composer: textbox "Your reply", buttons "Draft with Claude",
//    "Send reply".
//  - the file bar button "Open in Rider · line 46" (exactly one /^Open in Rider/ button).
//  - the panel <section aria-label="Commit and push"> with buttons "Commit", "Push and reply".

const PROJECT = 'mobile/mobile-app';
const IID = 480;
const PATH = 'src/App/Workers/UploadWorker.cs';
const NOTICE = 'Check out feature/upload-retry to fix here. The app never switches your branch.';

type AuthorMr = Awaited<ReturnType<IpcClient['authorMr']>>;
type Thread = AuthorMr['threads'][number];

/** The mock's open threads of !480, to build a General thread from the first. */
async function threadsOf(): Promise<Thread[]> {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  return (await base.authorMr(PROJECT, IID)).threads;
}

/** !480 of the mock with the checkout read-only (or not) and anything else replaced. */
async function backend(over: Partial<AuthorMr> = {}, onSourceBranch = false) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const mr = await base.authorMr(PROJECT, IID);
  const authorMr = vi.fn(() => Promise.resolve({ ...mr, ...over, onSourceBranch }));
  const riderOpen = vi.fn(() => Promise.resolve());
  return { client: { ...base, authorMr, riderOpen }, riderOpen };
}

async function openAuthor(over: Partial<AuthorMr> = {}, onSourceBranch = false) {
  const rec = await backend(over, onSourceBranch);
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

const waiting = (pushed: boolean): WaitingReply => ({
  reply: {
    id: 'queued-reply-7',
    discussion: 'author-t1',
    body: 'Fixed in 9e1d4b7. Backoff doubles.',
    resolve: true,
    afterSha: '9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40',
    state: 'queued',
    error: null,
  },
  pushed,
});

const general = (all: Thread[]): Thread[] => {
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
          body: 'Please add a short note to the changelog.',
          createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          mine: false,
        },
      ],
    },
  ];
};

describe('S-10 read-only when the checkout is not on the source branch (F-26.8)', () => {
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
    useAuthorCommitStore.getState().reset();
  });

  it('F-26.8 says to check out the MR’s source branch and that the app never switches it', async () => {
    await openAuthor();
    await card();

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  it('F-26.8 names the source branch of the MR, whatever it is', async () => {
    await openAuthor({ sourceBranch: 'feature/zażółć-ąę' });
    await card();

    expect(
      screen.getByText(
        'Check out feature/zażółć-ąę to fix here. The app never switches your branch.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('F-26.8 hides Fix with Claude and Fix in Rider, keeps Reply and Open in Rider', async () => {
    const { riderOpen } = await openAuthor();
    const thread = within(await card());

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(thread.queryByRole('button', { name: 'Fix with Claude' })).toBeNull();
    expect(thread.queryByRole('button', { name: 'Fix in Rider' })).toBeNull();
    expect(thread.getByRole('button', { name: 'Reply' })).toBeEnabled();
    const rider = screen.getAllByRole('button', { name: /^Open in Rider/ });
    expect(rider).toHaveLength(1);
    const [open] = rider;
    if (!open) throw new Error('no Open in Rider button');
    expect(open).toHaveAccessibleName('Open in Rider · line 46');
    await userEvent.click(open);
    expect(riderOpen).toHaveBeenCalledWith(PATH, 46);
  });

  it('F-26.8 the notice stays when another thread is selected, and still only once', async () => {
    await openAuthor();
    await card();

    await userEvent.click(option(/Piotr S\./));

    expect(await screen.findAllByText(NOTICE)).toHaveLength(1);
  });

  it('F-26.8 a question keeps its composer: Draft with Claude and Send reply', async () => {
    await openAuthor();
    await card();

    await userEvent.click(option(/Piotr S\./));

    const thread = within(await card());
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(thread.getByRole('textbox', { name: 'Your reply' })).toBeEnabled();
    expect(thread.getByRole('button', { name: 'Draft with Claude' })).toBeEnabled();
    expect(thread.getByRole('button', { name: 'Send reply' })).toBeInTheDocument();
    expect(thread.queryByRole('button', { name: 'Fix with Claude' })).toBeNull();
    expect(thread.queryByRole('button', { name: 'Fix in Rider' })).toBeNull();
  });

  it('F-26.8 a General thread has the notice and Reply, and no Open in Rider (no file)', async () => {
    await openAuthor({ threads: general(await threadsOf()) });
    const thread = within(await card());

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(thread.getByRole('button', { name: 'Reply' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^Open in Rider/ })).toBeNull();
    expect(thread.queryByRole('button', { name: 'Fix with Claude' })).toBeNull();
  });

  it('F-26.8 without an open thread there is nothing to fix and no notice', async () => {
    await openAuthor({ threads: [], toAnswer: 0 });
    await screen.findByRole('complementary', { name: 'Threads on your MR' });

    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Thread' })).toBeNull();
  });

  it('F-26.8 a commit left open from an earlier visit is not offered: no Commit, no Push and reply', async () => {
    useAuthorCommitStore.getState().open('author-t1', 'Address review on UploadWorker.cs:46');
    await openAuthor();
    await card();

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Commit and push' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Push and reply' })).toBeNull();
  });

  it('F-26.8 a reply queued and not pushed yet offers no Push and reply', async () => {
    await openAuthor({ waiting: [waiting(false)] });
    await card();

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Push and reply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('F-26.8 a queued reply whose commit is already on origin keeps Send reply', async () => {
    await openAuthor({ waiting: [waiting(true)] });
    await card();

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Send reply' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Push and reply' })).toBeNull();
  });

  it('F-26.8 on the source branch there is no notice and Fix, Commit and Push stay (control)', async () => {
    useAuthorCommitStore.getState().open('author-t1', 'Address review on UploadWorker.cs:46');
    await openAuthor({}, true);
    const thread = within(await card());

    expect(screen.queryByText(/to fix here\. The app never switches your branch\./)).toBeNull();
    expect(thread.getByRole('button', { name: 'Fix with Claude' })).toBeEnabled();
    expect(thread.getByRole('button', { name: 'Fix in Rider' })).toBeEnabled();
    expect(thread.getByRole('button', { name: 'Reply' })).toBeEnabled();
    expect(await screen.findByRole('region', { name: 'Commit and push' })).toBeInTheDocument();
  });
});
