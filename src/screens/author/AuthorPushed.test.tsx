import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { renderApp } from '../../test/renderApp';

// F-26.6: S-10 after a successful Push and reply (docs/plans/M7.md F-26.6, decision 13;
// Author.dc.html `cDone`). The region <section aria-label="Commit and push"> shows the badge
// "Pushed" (own element, as in F-26.5), then a sentence in its own element and a link:
//   resolve on : "Replied to Marta and resolved the thread."
//   resolve off: "Replied to Marta. The thread stays open."   (the mock's copy; the plan row names
//                only the first sentence "Replied to <name>.", the mock adds the second)
// <name> is the first name of the thread's author, no pronouns. The link goes to S-08 of the MR
// (/mr/480/pipeline). New IPC command, a GitLab read, called only after the push is done (never on
// load, never while committed, never after "Pull first"):
//   authorPushPipeline(project, iid, sha) -> PipelineTab | null
// with the FULL sha of the pushed commit. null = GitLab has not started the pipeline yet: the link
// reads "Pipeline starting…"; the screen asks again until it is found, for up to 30 s, and stops
// asking after that (the link then stays "Pipeline starting…"). Found: "Pipeline #<number> <state>"
// with <state> in lower case: running, passed, failed… (the mock: "Pipeline #18360 running"). A
// failed lookup is silent: the link stays "Pipeline starting…", no alert.
//
// The thread moves with the push (Author.dc.html `statusOf`): with Resolve on the tag reads
// "Resolved" (green) and with it off "Replied" (blue); the heading counts only the threads still to
// answer. The core drops a resolved thread from the open list and counts it as resolved earlier
// (mock: toAnswer 1, resolved.count 2), but this visit keeps the thread listed and selected, so
// its panel with the sentence and the link stays; the "resolved earlier" line does not count it a
// second time (the mock: "1 resolved earlier · typo in a log message").
//
// Locators the screen keeps: the region above; inside it the own-text elements "Pushed" and the
// sentence, the link by its name; the list option of the thread with the tag as an own element
// with data-color; the heading level 1.

const IID = 480;
const PROJECT = 'mobile/mobile-app';
const COMMITTED = { sha: '9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40', shortSha: '9e1d4b7' };
const DETECTED = 'Change detected from Rider. Commit it below.';
const RESOLVED_LINE = '1 resolved earlier · typo in a log message';
const SENTENCE_ON = 'Replied to Marta and resolved the thread.';
const SENTENCE_OFF = 'Replied to Marta. The thread stays open.';
const TAB = {
  id: 18360,
  number: 18360,
  sha: COMMITTED.sha,
  version: 2,
  latest: true,
  status: 'running',
} as const;

type FixWatch = IpcClient['fixWatch'];
type FixWatchEvent = Parameters<Parameters<FixWatch>[1]>[0];
type Push = IpcClient['authorPushAndReply'];
type Lookup = IpcClient['authorPushPipeline'];

interface Watch {
  emit: (event: FixWatchEvent) => void;
}

async function backend(over: { push?: Push; lookup?: Lookup } = {}) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const watches: Watch[] = [];
  const fixWatch = vi.fn<FixWatch>((_file, onEvent) => {
    watches.push({ emit: onEvent });
    return Promise.resolve(() => undefined);
  });
  const gitCommit = vi.fn<IpcClient['gitCommit']>(() => Promise.resolve(COMMITTED));
  const authorPushAndReply = vi.fn<Push>(over.push ?? base.authorPushAndReply);
  const authorPushPipeline = vi.fn<Lookup>(over.lookup ?? base.authorPushPipeline);
  return {
    client: { ...base, fixWatch, gitCommit, authorPushAndReply, authorPushPipeline },
    watches,
    authorPushPipeline,
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

async function committed(ctx: Awaited<ReturnType<typeof openAuthor>>) {
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
  await userEvent.click(within(await panel()).getByRole('button', { name: 'Commit' }));
  await within(await panel()).findByText('not pushed yet');
}

/** Commit, optionally switch Resolve off, Push and reply; resolves once the form is gone. */
async function pushed(ctx: Awaited<ReturnType<typeof openAuthor>>, resolve = true) {
  await committed(ctx);
  const region = within(await panel());
  if (!resolve) await userEvent.click(region.getByRole('checkbox', { name: 'Resolve the thread' }));
  await userEvent.click(region.getByRole('button', { name: 'Push and reply' }));
  await waitFor(() => {
    expect(
      within(screen.getByRole('region', { name: 'Commit and push' })).getByText('Pushed'),
    ).toBeInTheDocument();
  });
  return within(screen.getByRole('region', { name: 'Commit and push' }));
}

const heading = () => screen.getByRole('heading', { level: 1 });

describe('S-10 after Push and reply (F-26.6)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('F-26.6 with Resolve on the panel says Pushed and “Replied to Marta and resolved the thread.”', async () => {
    const ctx = await openAuthor({ lookup: () => Promise.resolve(null) });

    const done = await pushed(ctx);

    expect(done.getByText('Pushed')).toBeInTheDocument();
    expect(done.getByText(SENTENCE_ON)).toBeInTheDocument();
    expect(done.queryByRole('button', { name: 'Push and reply' })).not.toBeInTheDocument();
    expect(done.queryByText('The thread stays open', { exact: false })).not.toBeInTheDocument();
  });

  it('F-26.6 with Resolve off the sentence is “Replied to Marta. The thread stays open.”', async () => {
    const ctx = await openAuthor({ lookup: () => Promise.resolve(null) });

    const done = await pushed(ctx, false);

    expect(done.getByText(SENTENCE_OFF)).toBeInTheDocument();
    expect(done.queryByText('resolved the thread', { exact: false })).not.toBeInTheDocument();
  });

  it('F-26.6 until GitLab has started the pipeline the link reads “Pipeline starting…” and opens S-08', async () => {
    const ctx = await openAuthor({ lookup: () => Promise.resolve(null) });

    const done = await pushed(ctx);

    const link = await done.findByRole('link', { name: 'Pipeline starting…' });
    expect(link).toHaveAttribute('href', expect.stringMatching(/\/mr\/480\/pipeline$/));
    expect(ctx.authorPushPipeline).toHaveBeenCalledWith(PROJECT, IID, COMMITTED.sha);
  });

  it('F-26.6 the link names the new pipeline and its state once GitLab has it', async () => {
    const ctx = await openAuthor({ lookup: () => Promise.resolve(TAB) });

    const done = await pushed(ctx);

    const link = await done.findByRole('link', { name: 'Pipeline #18360 running' });
    expect(link).toHaveAttribute('href', expect.stringMatching(/\/mr\/480\/pipeline$/));
    expect(done.queryByRole('link', { name: 'Pipeline starting…' })).not.toBeInTheDocument();
  });

  it.each([
    ['passed', 'Pipeline #18360 passed'],
    ['failed', 'Pipeline #18360 failed'],
  ] as const)('F-26.6 a %s pipeline reads “%s”', async (status, name) => {
    const ctx = await openAuthor({ lookup: () => Promise.resolve({ ...TAB, status }) });

    const done = await pushed(ctx);

    expect(await done.findByRole('link', { name })).toBeInTheDocument();
  });

  it('F-26.6 the screen asks again until the pipeline exists and then shows it', async () => {
    const lookup = vi.fn<Lookup>().mockResolvedValueOnce(null).mockResolvedValue(TAB);
    const ctx = await openAuthor({ lookup });

    const done = await pushed(ctx);

    expect(await done.findByRole('link', { name: 'Pipeline starting…' })).toBeInTheDocument();
    await waitFor(
      () => {
        expect(done.getByRole('link', { name: 'Pipeline #18360 running' })).toBeInTheDocument();
      },
      { timeout: 10_000 },
    );
    expect(lookup.mock.calls.length).toBeGreaterThanOrEqual(2);
  }, 20_000);

  it('F-26.6 it stops asking after 30 seconds and the link stays “Pipeline starting…”', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const lookup = vi.fn<Lookup>().mockResolvedValue(null);
    const ctx = await openAuthor({ lookup });

    const done = await pushed(ctx);
    await done.findByRole('link', { name: 'Pipeline starting…' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    const asked = lookup.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(asked).toBeGreaterThanOrEqual(2);
    expect(asked).toBeLessThanOrEqual(31);
    expect(lookup.mock.calls.length).toBe(asked);
    expect(done.getByRole('link', { name: 'Pipeline starting…' })).toBeInTheDocument();
  }, 30_000);

  it('F-26.6 a lookup that fails is silent: the sentence and “Pipeline starting…” stay and no alert shows', async () => {
    const lookup = vi.fn<Lookup>().mockRejectedValue(
      new IpcError({
        code: 'GITLAB_UNREACHABLE',
        message: "Couldn't reach GitLab.",
        retryable: true,
      }),
    );
    const ctx = await openAuthor({ lookup });

    const done = await pushed(ctx);

    expect(await done.findByRole('link', { name: 'Pipeline starting…' })).toBeInTheDocument();
    await waitFor(() => {
      expect(lookup).toHaveBeenCalled();
    });
    expect(done.getByText(SENTENCE_ON)).toBeInTheDocument();
    expect(done.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('F-26.6 no pipeline is looked up before the push is done: not while committed, not after “Pull first”', async () => {
    const push = vi.fn<Push>().mockResolvedValue({ kind: 'pullFirst' });
    const ctx = await openAuthor({ push });

    await committed(ctx);
    expect(ctx.authorPushPipeline).not.toHaveBeenCalled();
    await userEvent.click(within(await panel()).getByRole('button', { name: 'Push and reply' }));
    await within(await panel()).findByText('Pull first');

    expect(ctx.authorPushPipeline).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /^Pipeline (starting|#)/ })).not.toBeInTheDocument();
  });

  it('F-26.6 with Resolve on the thread reads Resolved (green), only Piotr’s question is still to answer', async () => {
    const ctx = await openAuthor({ lookup: () => Promise.resolve(null) });

    await pushed(ctx);

    const marta = option(/Marta K\./);
    expect(within(marta).getByText('Resolved')).toHaveAttribute('data-color', 'green');
    expect(within(marta).queryByText('Fixed locally · not pushed')).not.toBeInTheDocument();
    expect(heading()).toHaveTextContent('1 thread to answer');
    expect(within(option(/Piotr S\./)).getByText('Question')).toBeInTheDocument();
  });

  it('F-26.6 the resolved thread is not counted a second time in “resolved earlier”', async () => {
    const ctx = await openAuthor({ lookup: () => Promise.resolve(null) });

    await pushed(ctx);

    expect(screen.getByText(RESOLVED_LINE)).toBeInTheDocument();
  });

  it('F-26.6 with Resolve off the thread reads Replied (blue) and no longer waits for an answer', async () => {
    const ctx = await openAuthor({ lookup: () => Promise.resolve(null) });

    await pushed(ctx, false);

    expect(within(option(/Marta K\./)).getByText('Replied')).toHaveAttribute('data-color', 'blue');
    expect(heading()).toHaveTextContent('1 thread to answer');
    expect(screen.getByText(RESOLVED_LINE)).toBeInTheDocument();
  });

  it('F-26.6 the sentence and the link survive picking another thread and coming back', async () => {
    const ctx = await openAuthor({ lookup: () => Promise.resolve(TAB) });
    await pushed(ctx);

    await userEvent.click(option(/Piotr S\./));
    expect(screen.queryByRole('region', { name: 'Commit and push' })).not.toBeInTheDocument();
    await userEvent.click(option(/Marta K\./));

    const back = within(await panel());
    expect(back.getByText('Pushed')).toBeInTheDocument();
    expect(back.getByText(SENTENCE_ON)).toBeInTheDocument();
    expect(await back.findByRole('link', { name: 'Pipeline #18360 running' })).toBeInTheDocument();
    expect(within(option(/Marta K\./)).getByText('Resolved')).toBeInTheDocument();
  });
});
