import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { renderApp } from '../../test/renderApp';

// F-26.5: S-10 after Commit (docs/plans/M7.md F-26.5, decisions 11 and 12; Author.dc.html `cPush`).
// The region <section aria-label="Commit and push"> now shows the badge "Committed", the short sha
// and "not pushed yet" (three elements, as the mock), the caption "Sent to Marta’s thread after
// push" (the first name of the thread's author), the reply to be sent as a textbox named
// "Reply to send" (editable, decision below), the checkbox "Resolve the thread" (checked), the
// button **Push and reply** and the hint "The reply waits for the push, so the link always works.".
//
// The reply is "Fixed in <short sha>. <one sentence>.": the sentence is the commit message as typed
// (its first line) with one full stop at the end, never two, and no Claude call (the owner's rule:
// Claude only on a click). It is queued in the core right after a successful Commit:
//   authorQueueReply(project, iid, discussion, body, resolve, afterSha) -> { id, discussion, body,
//   resolve, afterSha, state: 'queued' | 'sent', error: string | null }
// (afterSha = the FULL sha of the commit). Edits are sent by calling authorQueueReply again just
// before the push; the last call before authorPushAndReply(project, iid, id) carries what the box
// and the checkbox show. authorPushAndReply answers { kind: 'done', remoteBranch, resolved } or
// { kind: 'pullFirst' }; a rejection (push or reply failed) keeps everything and offers **Retry**.
// Nothing is pushed or sent without the click on Push and reply (or Retry).
//
// Locators the screen keeps: the region above; inside it getByText('Committed') (own element),
// getByText('not pushed yet') (own element), the textbox "Reply to send", the checkbox
// "Resolve the thread", the buttons "Push and reply" and "Retry"; the busy line is a role="status"
// element with the text "Pushing to origin/feature/upload-retry…"; a failure is a role="alert"
// element with the error's message; Pull first is the text "Pull first" and the sentence below.
// F-26.6 owns what the card says after a successful push.

const IID = 480;
const PROJECT = 'mobile/mobile-app';
const DISCUSSION = 'author-t1';
const COMMITTED = { sha: '9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40', shortSha: '9e1d4b7' };
const DETECTED = 'Change detected from Rider. Commit it below.';
const DEFAULT_REPLY = 'Fixed in 9e1d4b7. Address review on UploadWorker.cs:46.';
const PULL_FIRST = "The remote has commits you don't have. Pull with rebase in Rider.";
const BUSY = 'Pushing to origin/feature/upload-retry…';
const HINT = 'The reply waits for the push, so the link always works.';
const DONE = {
  kind: 'done',
  remoteBranch: 'origin/feature/upload-retry',
  resolved: true,
} as const;

type FixWatch = IpcClient['fixWatch'];
type FixWatchEvent = Parameters<Parameters<FixWatch>[1]>[0];
type Push = IpcClient['authorPushAndReply'];

interface Watch {
  emit: (event: FixWatchEvent) => void;
}

async function backend(over: { push?: Push } = {}) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const watches: Watch[] = [];
  const fixWatch = vi.fn<FixWatch>((_file, onEvent) => {
    watches.push({ emit: onEvent });
    return Promise.resolve(() => undefined);
  });
  const gitCommit = vi.fn<IpcClient['gitCommit']>(() => Promise.resolve(COMMITTED));
  const authorQueueReply = vi.fn<IpcClient['authorQueueReply']>(base.authorQueueReply);
  const authorPushAndReply = vi.fn<Push>(over.push ?? base.authorPushAndReply);
  return {
    client: { ...base, fixWatch, gitCommit, authorQueueReply, authorPushAndReply },
    watches,
    gitCommit,
    authorQueueReply,
    authorPushAndReply,
  };
}

async function openAuthor(over?: Parameters<typeof backend>[0]) {
  const rec = await backend(over);
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));
  return { ...app, ...rec };
}

const card = () => screen.findByRole('region', { name: 'Thread' });
const panel = () => screen.findByRole('region', { name: 'Commit and push' });
const option = (name: RegExp) => {
  const found = within(screen.getByRole('listbox', { name: 'Threads' }))
    .getAllByRole('option')
    .find((o) => name.test(o.textContent));
  if (!found) throw new Error(`no thread option ${String(name)}`);
  return found;
};

/** Fix in Rider, the change is seen, Commit with `message` (the prefilled one when omitted). */
async function committed(ctx: Awaited<ReturnType<typeof openAuthor>>, message?: string) {
  await userEvent.click(await within(await card()).findByRole('button', { name: 'Fix in Rider' }));
  await waitFor(() => {
    expect(ctx.watches).toHaveLength(1);
  });
  const watch = ctx.watches[0];
  if (!watch) throw new Error('no watch');
  act(() => {
    watch.emit({ kind: 'changed' });
  });
  await within(await card()).findByText(DETECTED);
  const form = within(await panel());
  if (message !== undefined) {
    await userEvent.clear(form.getByRole('textbox', { name: 'Commit message' }));
    await userEvent.type(form.getByRole('textbox', { name: 'Commit message' }), message);
  }
  await userEvent.click(form.getByRole('button', { name: 'Commit' }));
  const done = within(await panel());
  await done.findByText('not pushed yet');
  return done;
}

const replyBox = () => within(screen.getByRole('region', { name: 'Commit and push' }));
const reply = () => replyBox().getByRole('textbox', { name: 'Reply to send' });
const resolveBox = () => replyBox().getByRole('checkbox', { name: 'Resolve the thread' });
const pushButton = () => replyBox().getByRole('button', { name: 'Push and reply' });

/** The call `index` (0-based) of a spy; fails loudly when it was not made. */
const callOf = (spy: { mock: { calls: readonly unknown[][] } }, index: number) => {
  const call = spy.mock.calls[index];
  if (!call) throw new Error(`call ${String(index)} was not made`);
  return call;
};

describe('S-10 Push and reply after a commit (F-26.5)', () => {
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

  it('F-26.5 after Commit the panel says “Committed”, the short sha and “not pushed yet”', async () => {
    const ctx = await openAuthor();
    const done = await committed(ctx);

    expect(done.getByText('Committed')).toBeInTheDocument();
    expect(done.getByText('9e1d4b7')).toBeInTheDocument();
    expect(done.getByText('not pushed yet')).toBeInTheDocument();
    expect(done.queryByRole('button', { name: 'Commit' })).toBeNull();
  });

  it('F-26.5 shows the reply to be sent “Fixed in <sha>. <sentence>.”, who gets it and the hint', async () => {
    const ctx = await openAuthor();
    const done = await committed(ctx);

    expect(done.getByText('Sent to Marta’s thread after push')).toBeInTheDocument();
    expect(reply()).toHaveValue(DEFAULT_REPLY);
    expect(done.getByText(HINT)).toBeInTheDocument();
  });

  it('F-26.5 “Resolve the thread” is on by default and Push and reply is offered', async () => {
    const ctx = await openAuthor();
    await committed(ctx);

    expect(resolveBox()).toBeChecked();
    expect(pushButton()).toBeEnabled();
  });

  it('F-26.5 the sentence is the commit message with one full stop, as the mock’s “Backoff now doubles…”', async () => {
    const withStop = await openAuthor();
    await committed(withStop, 'Backoff doubles and stops at 60 s.');
    expect(reply()).toHaveValue('Fixed in 9e1d4b7. Backoff doubles and stops at 60 s.');
  });

  it('F-26.5 a commit message without a full stop gets one', async () => {
    const ctx = await openAuthor();
    await committed(ctx, 'Backoff doubles');

    expect(reply()).toHaveValue('Fixed in 9e1d4b7. Backoff doubles.');
  });

  it('F-26.5 Commit queues the reply in the core with the full sha and sends nothing', async () => {
    const ctx = await openAuthor();
    await committed(ctx, 'Backoff doubles and stops at 60 s.');

    await waitFor(() => {
      expect(ctx.authorQueueReply).toHaveBeenCalled();
    });
    expect(ctx.authorQueueReply).toHaveBeenLastCalledWith(
      PROJECT,
      IID,
      DISCUSSION,
      'Fixed in 9e1d4b7. Backoff doubles and stops at 60 s.',
      true,
      COMMITTED.sha,
    );
    expect(ctx.authorPushAndReply).not.toHaveBeenCalled();
  });

  it('F-26.5 the thread in the list reads “Fixed locally · not pushed” once the reply is queued', async () => {
    const ctx = await openAuthor();
    await committed(ctx);

    await waitFor(() => {
      expect(option(/Marta K\./)).toHaveTextContent('Fixed locally · not pushed');
    });
  });

  it('F-26.5 Push and reply sends the edited reply and the switch as they are, for the queued reply', async () => {
    const ctx = await openAuthor();
    await committed(ctx);
    await userEvent.clear(reply());
    await userEvent.type(reply(), 'Fixed in 9e1d4b7. Backoff doubles.');
    await userEvent.click(resolveBox());

    await userEvent.click(pushButton());

    await waitFor(() => {
      expect(ctx.authorPushAndReply).toHaveBeenCalledTimes(1);
    });
    const push = callOf(ctx.authorPushAndReply, 0);
    expect(push.slice(0, 2)).toEqual([PROJECT, IID]);
    const lastQueue = ctx.authorQueueReply.mock.calls.at(-1);
    expect(lastQueue?.slice(2)).toEqual([
      DISCUSSION,
      'Fixed in 9e1d4b7. Backoff doubles.',
      false,
      COMMITTED.sha,
    ]);
    const queued = (await ctx.authorQueueReply.mock.results.at(-1)?.value) as unknown;
    expect(push[2]).toBe((queued as { id: string }).id);
    expect(Math.max(...ctx.authorQueueReply.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...ctx.authorPushAndReply.mock.invocationCallOrder),
    );
  });

  it('F-26.5 while pushing the panel says “Pushing to origin/feature/upload-retry…” and offers no second click', async () => {
    let finish: (value: Awaited<ReturnType<Push>>) => void = () => undefined;
    const ctx = await openAuthor({
      push: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await committed(ctx);

    await userEvent.click(pushButton());

    const busy = await screen.findByText(BUSY);
    expect(busy.closest('[role="status"]')).not.toBeNull();
    expect(
      within(await panel()).queryByRole('button', { name: 'Push and reply' }),
    ).not.toBeInTheDocument();
    await act(async () => {
      finish(DONE);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByText(BUSY)).not.toBeInTheDocument();
    });
    expect(ctx.authorPushAndReply).toHaveBeenCalledTimes(1);
  });

  it('F-26.5 a failed push shows the reason, keeps the reply and offers Retry, which pushes again for the same reply', async () => {
    const push = vi
      .fn<Push>()
      .mockRejectedValueOnce(
        new IpcError({
          code: 'GIT_FAILED',
          message: 'Push failed. The remote refused it.',
          retryable: true,
        }),
      )
      .mockResolvedValue(DONE);
    const ctx = await openAuthor({ push });
    await committed(ctx);
    await userEvent.clear(reply());
    await userEvent.type(reply(), 'Fixed in 9e1d4b7. Edited.');

    await userEvent.click(pushButton());

    const alert = await within(await panel()).findByRole('alert');
    expect(alert).toHaveTextContent('Push failed. The remote refused it.');
    expect(reply()).toHaveValue('Fixed in 9e1d4b7. Edited.');
    expect(
      within(await panel()).queryByRole('button', { name: 'Push and reply' }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(await panel()).getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledTimes(2);
    });
    expect(callOf(push, 1)).toEqual(callOf(push, 0));
    await waitFor(() => {
      expect(
        within(screen.getByRole('region', { name: 'Commit and push' })).queryByRole('button', {
          name: 'Retry',
        }),
      ).not.toBeInTheDocument();
    });
  });

  it('F-26.5 a remote with commits you don’t have is “Pull first”: nothing says Pushed and Push and reply stays', async () => {
    const push = vi.fn<Push>().mockResolvedValue({ kind: 'pullFirst' });
    const ctx = await openAuthor({ push });
    await committed(ctx);

    await userEvent.click(pushButton());

    const region = within(await panel());
    expect(await region.findByText('Pull first')).toBeInTheDocument();
    expect(region.getByText(PULL_FIRST)).toBeInTheDocument();
    expect(reply()).toHaveValue(DEFAULT_REPLY);
    expect(region.queryByText('Pushed')).not.toBeInTheDocument();
    await userEvent.click(pushButton());
    await waitFor(() => {
      expect(push).toHaveBeenCalledTimes(2);
    });
    expect(callOf(push, 1)).toEqual(callOf(push, 0));
  });

  it('F-26.5 the edited reply, the switch and a failure survive picking another thread and coming back', async () => {
    const push = vi.fn<Push>().mockRejectedValue(
      new IpcError({
        code: 'GIT_FAILED',
        message: 'Push failed. The remote refused it.',
        retryable: true,
      }),
    );
    const ctx = await openAuthor({ push });
    await committed(ctx);
    await userEvent.clear(reply());
    await userEvent.type(reply(), 'Fixed in 9e1d4b7. Kept.');
    await userEvent.click(resolveBox());
    await userEvent.click(pushButton());
    await within(await panel()).findByRole('alert');

    await userEvent.click(option(/Piotr S\./));
    expect(screen.queryByRole('region', { name: 'Commit and push' })).not.toBeInTheDocument();
    await userEvent.click(option(/Marta K\./));

    const back = within(await panel());
    expect(back.getByText('not pushed yet')).toBeInTheDocument();
    expect(reply()).toHaveValue('Fixed in 9e1d4b7. Kept.');
    expect(resolveBox()).not.toBeChecked();
    expect(back.getByRole('alert')).toHaveTextContent('Push failed. The remote refused it.');
    expect(back.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
