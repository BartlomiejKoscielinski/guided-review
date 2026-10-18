import { act, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { createQueryClient } from '../../app/queryClient';
import { createAppRouter } from '../../app/router';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { IpcProvider } from '../../ipc/IpcProvider';
import { createMockClient } from '../../ipc/mock';
import type { Thread } from '../../ipc/types/Thread';
import type { ThreadCheck } from '../../ipc/types/ThreadCheck';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-13.3 (docs/plans/M5.md, decision 12): the Threads tab of S-05 has a "Check with Claude" button
// (a purple Claude square before its word) when at least one open thread was written on an older
// version (`outdated`, resolvable, not resolved). Claude runs only when it is clicked
// (`claudeThreadCheck(session, onEvent)`, never on opening the tab, the screen or a restored
// start). The result is a list of { discussionId, commit (full id), hint }; the thread it names
// shows the chip "Claude: <hint> in <first seven characters of the commit>" under its meta line
// (SummaryDesk.dc.html: a purple square and "Claude: index added in a91f2c0"). When Claude names
// none, "Claude found no thread addressed by a later commit." stands in the tab; a failed check
// says "Couldn't check the threads." with Retry. Nothing is resolved by Claude: the row keeps its
// Resolve button and only the reviewer's click resolves.
//
// Locators the screen keeps: the button named exactly "Check with Claude" (role button); the chip
// as one element whose own text is "Claude: index added in a91f2c0" with a Square
// (data-color="purple") inside it, in the thread's row (role listitem in the tabpanel); the
// running text "Claude is checking the threads…", the "none" line and the failure line as plain
// text in the tab; the failure as role=alert with a button "Retry" inside it.
//
// Decisions locked here (tests stage, M5 / F-13.3): while the check runs the button is disabled
// and "Claude is checking the threads…" stands in the tab (like "Claude is writing a summary…",
// F-12.4); the failure line carries no message of its own, like "Couldn't suggest a summary.";
// the run belongs to the screen, so it outlives a visit to Drafts and its chips are there on
// return; the button stays after a result, so the reviewer can check again (the core answers a
// repeat from its cache); a chip is shown on an open thread only; a "drafts only" session
// (F-12.7) has no review worktree to read the commits from, so it has no button; a restored
// summary (F-30.4) starts no Claude work.

const MR_SESSION = 'mock-mr-session-1';
const COMMIT = 'a91f2c0d4e8b5f36c17a09b2d3e4f5a6b7c8d9e0';
const CHIP = 'Claude: index added in a91f2c0';
const CHECK = 'Check with Claude';
const RUNNING = 'Claude is checking the threads…';
const NONE = 'Claude found no thread addressed by a later commit.';
const FAILED = "Couldn't check the threads.";

const KICK = 'Kick() is called on the UI thread. Does the worker block anything here?';
const INDEX = 'No index on CreatedAt, but every read sorts by it.';
const NETWORK = 'Do we need ACCESS_NETWORK_STATE here?';
const BANNER = 'Banner color should come from resources, not be hardcoded.';
const GENERAL = 'Thanks for the quick turnaround on this one.';

interface Seed {
  id: string;
  body: string;
  resolved?: boolean;
  resolvable?: boolean;
  outdated?: boolean;
}

let noteId = 0;
const thread = ({
  id,
  body,
  resolved = false,
  resolvable = true,
  outdated = false,
}: Seed): Thread => ({
  id,
  resolvable,
  resolved,
  outdated,
  notes: [
    {
      id: (noteId += 1),
      author: { username: 'pawel.s', name: 'Paweł S.' },
      body,
      createdAt: '2026-10-12T09:14:00.000Z',
    },
  ],
});

/** SummaryDesk.dc.html's threads: KICK is current; INDEX and NETWORK were written on an older version. */
const mockThreads = (): Thread[] => [
  thread({ id: 't-1', body: KICK }),
  thread({ id: 't-2', body: INDEX, outdated: true }),
  thread({ id: 't-3', body: NETWORK, outdated: true }),
  thread({ id: 't-4', body: BANNER, resolved: true, outdated: true }),
  thread({ id: 't-g', body: GENERAL, resolvable: false, outdated: true }),
];

const addressed = (...ids: string[]): ThreadCheck => ({
  hints: ids.map((discussionId) => ({ discussionId, commit: COMMIT, hint: 'index added' })),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Options {
  threads?: Thread[];
  /** What `claudeThreadCheck` answers; each call takes the next one (the last repeats). */
  checks?: (ThreadCheck | Error | Promise<ThreadCheck>)[];
}

/** S-05 of the MR session without drafts, opened the way Finish review does: on Threads. */
async function openSummary({ threads = mockThreads(), checks = [addressed('t-2')] }: Options = {}) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  let current = threads;
  let calls = 0;
  const claudeThreadCheck = vi.fn((_session: string, _onEvent: unknown) => {
    const next = checks[Math.min(calls, checks.length - 1)];
    calls += 1;
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? addressed());
  });
  const gitlabResolve = vi.fn((_session: string, discussion: string, resolved: boolean) => {
    current = current.map((t) => (t.id === discussion ? { ...t, resolved } : t));
    return Promise.resolve();
  });
  const client = {
    ...base,
    gitlabDiscussions: () => Promise.resolve(current),
    gitlabResolve,
    claudeThreadCheck,
  } as unknown as IpcClient;
  const router = createAppRouter({ screen: 'S-01' });
  render(
    <IpcProvider client={client}>
      <QueryClientProvider client={createQueryClient()}>
        <App router={router} />
      </QueryClientProvider>
    </IpcProvider>,
  );
  await act(() => router.navigate(`/session/${MR_SESSION}/summary`));
  await screen.findByRole('group', { name: 'Thread filter' });
  return { claudeThreadCheck, gitlabResolve };
}

const checkButton = () => screen.queryByRole('button', { name: CHECK });
const panel = () => within(screen.getByRole('tabpanel'));
const rowOf = (body: string): HTMLElement => {
  const row = panel().getByText(body).closest('li');
  if (!row) throw new Error(`no row for ${body}`);
  return row;
};
const chips = () => screen.queryAllByText(/^Claude: /);

describe('S-05 Threads tab: Check with Claude (F-13.3)', () => {
  it('F-13.3 the Threads tab offers Check with Claude, with a purple Claude square, when an open thread was written on an older version, and Claude is not asked until it is clicked', async () => {
    const { claudeThreadCheck } = await openSummary();
    const button = await screen.findByRole('button', { name: CHECK });
    expect(button).toBeEnabled();
    expect(button.querySelector('[data-color="purple"]')).not.toBeNull();
    // Opening the screen and the tab started nothing, and no row has a chip.
    expect(claudeThreadCheck).not.toHaveBeenCalled();
    expect(chips()).toEqual([]);
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByText(RUNNING)).toBeNull();
  });

  it.each([
    ['every open thread is on the reviewed version', [{ id: 't-1', body: KICK }]],
    [
      'the only older thread is resolved',
      [
        { id: 't-1', body: KICK },
        { id: 't-4', body: BANNER, resolved: true, outdated: true },
      ],
    ],
    [
      'the only older comment cannot be resolved',
      [
        { id: 't-1', body: KICK },
        { id: 't-g', body: GENERAL, resolvable: false, outdated: true },
      ],
    ],
  ] satisfies [string, Seed[]][])('F-13.3 no Check with Claude when %s', async (_name, seeds) => {
    const { claudeThreadCheck } = await openSummary({ threads: seeds.map(thread) });
    expect(await screen.findByText(KICK)).toBeInTheDocument();
    expect(checkButton()).toBeNull();
    expect(claudeThreadCheck).not.toHaveBeenCalled();
  });

  it('F-13.3 the Drafts tab has no Check with Claude', async () => {
    await openSummary();
    await screen.findByRole('button', { name: CHECK });
    await userEvent.click(screen.getByRole('tab', { name: /^Drafts/ }));
    expect(checkButton()).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /^Threads/ }));
    expect(await screen.findByRole('button', { name: CHECK })).toBeInTheDocument();
  });

  it('F-13.3 a restored summary offers no Check with Claude and starts no Claude work', async () => {
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    await base.reviewPlan(MR_SESSION, () => undefined);
    const { client, calls } = recordingClient(base);
    const app = renderApp({ screen: 'S-05', sessionId: MR_SESSION }, client);
    expect(app.router.state.location.state).toEqual({ restored: true });
    expect(
      await within(await screen.findByRole('tabpanel')).findByText(
        'Open the summary again to load the threads.',
      ),
    ).toBeInTheDocument();
    expect(checkButton()).toBeNull();
    expect(calls).not.toContain('claudeThreadCheck');
  });

  it('F-13.3 a drafts-only summary has no Check with Claude: no review worktree to read the commits from', async () => {
    const base = createMockClient({ latencyMs: 0 });
    const draft = await base.draftsCreateForMr('mobile/mobile-app', 482, {
      body: 'Is the keystore secret set for this branch?',
      position: null,
      severity: 'q',
    });
    const claudeThreadCheck = vi.fn(() => Promise.resolve(addressed('t-2')));
    const client = {
      ...base,
      gitlabDiscussions: () => Promise.resolve(mockThreads()),
      claudeThreadCheck,
    } as unknown as IpcClient;
    const app = renderApp({ screen: 'S-01' }, client);
    await act(() => app.router.navigate(`/session/${draft.sessionId}/summary`));
    await userEvent.click(await screen.findByRole('tab', { name: /^Threads/ }));
    expect(await panel().findByText(INDEX)).toBeInTheDocument();
    expect(checkButton()).toBeNull();
    expect(claudeThreadCheck).not.toHaveBeenCalled();
  });

  it('F-13.3 clicking runs the check for the session once; the button waits and "Claude is checking the threads…" stands while it runs', async () => {
    const run = deferred<ThreadCheck>();
    const { claudeThreadCheck } = await openSummary({ checks: [run.promise] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: CHECK }));

    expect(claudeThreadCheck).toHaveBeenCalledTimes(1);
    expect(claudeThreadCheck.mock.calls[0]?.[0]).toBe(MR_SESSION);
    expect(await screen.findByText(RUNNING)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CHECK })).toBeDisabled();
    // A second click while it runs does nothing.
    await user.click(screen.getByRole('button', { name: CHECK }));
    expect(claudeThreadCheck).toHaveBeenCalledTimes(1);
    expect(chips()).toEqual([]);

    await act(async () => {
      run.resolve(addressed('t-2'));
      await run.promise;
    });
    expect(await screen.findByText(CHIP)).toBeInTheDocument();
    expect(screen.queryByText(RUNNING)).toBeNull();
    expect(screen.getByRole('button', { name: CHECK })).toBeEnabled();
  });

  it('F-13.3 the thread Claude judges addressed shows "Claude: index added in a91f2c0" with a purple square; the other open threads show none and nothing is resolved', async () => {
    const { gitlabResolve } = await openSummary({ checks: [addressed('t-2')] });
    await userEvent.click(await screen.findByRole('button', { name: CHECK }));

    const chip = await screen.findByText(CHIP);
    expect(chip.querySelector('[data-color="purple"]')).not.toBeNull();
    expect(rowOf(INDEX)).toContainElement(chip);
    expect(chips()).toHaveLength(1);
    for (const body of [KICK, NETWORK]) {
      expect(within(rowOf(body)).queryByText(/^Claude: /)).toBeNull();
    }
    expect(screen.queryByText(NONE)).toBeNull();
    // The thread is still open: the reviewer decides.
    expect(gitlabResolve).not.toHaveBeenCalled();
    expect(within(rowOf(INDEX)).getByRole('button', { name: 'Resolve' })).toBeEnabled();
    expect(within(rowOf(INDEX)).queryByRole('button', { name: 'Reopen' })).toBeNull();
  });

  it('F-13.3 the chip shows the first seven characters of the commit and the hint as Claude gave it', async () => {
    await openSummary({
      checks: [
        {
          hints: [
            {
              discussionId: 't-2',
              commit: '0123456789abcdef0123456789abcdef01234567',
              hint: 'Enqueue awaited',
            },
          ],
        },
      ],
    });
    await userEvent.click(await screen.findByRole('button', { name: CHECK }));
    expect(await screen.findByText('Claude: Enqueue awaited in 0123456')).toBeInTheDocument();
  });

  it('F-13.3 when no thread is addressed the tab says "Claude found no thread addressed by a later commit." and no row has a chip', async () => {
    await openSummary({ checks: [{ hints: [] }] });
    await userEvent.click(await screen.findByRole('button', { name: CHECK }));
    expect(await screen.findByText(NONE)).toBeInTheDocument();
    expect(chips()).toEqual([]);
    expect(screen.queryByText(RUNNING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('F-13.3 a failed check says "Couldn\'t check the threads." with Retry, and Retry asks again and shows the hint', async () => {
    const limited = new IpcError({
      code: 'CLAUDE_LIMITED',
      message: 'Claude usage limit reached',
      retryable: true,
    });
    const { claudeThreadCheck } = await openSummary({ checks: [limited, addressed('t-2')] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: CHECK }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(FAILED)).toBeInTheDocument();
    expect(chips()).toEqual([]);
    expect(screen.queryByText(RUNNING)).toBeNull();

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(claudeThreadCheck).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(CHIP)).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('F-13.3 the chip is for an open thread: resolving the addressed thread takes it off, a hint for a resolved thread is not shown', async () => {
    await openSummary({ checks: [addressed('t-2', 't-4')] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: CHECK }));
    const chip = await screen.findByText(CHIP);
    // t-4 is resolved: only the open INDEX thread has the chip.
    expect(chips()).toHaveLength(1);
    expect(rowOf(INDEX)).toContainElement(chip);

    await user.click(within(rowOf(INDEX)).getByRole('button', { name: 'Resolve' }));
    expect(await within(rowOf(INDEX)).findByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(within(rowOf(INDEX)).queryByText(/^Claude: /)).toBeNull();
  });

  it('F-13.3 a check started on Threads runs on while Drafts is open: no second run, and the chip is there on return', async () => {
    const run = deferred<ThreadCheck>();
    const { claudeThreadCheck } = await openSummary({ checks: [run.promise] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: CHECK }));
    expect(await screen.findByText(RUNNING)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^Drafts/ }));
    await user.click(screen.getByRole('tab', { name: /^Threads/ }));
    // Back on Threads it is still running: the button waits, so no second run can start.
    expect(await screen.findByText(RUNNING)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CHECK })).toBeDisabled();

    await user.click(screen.getByRole('tab', { name: /^Drafts/ }));
    await act(async () => {
      run.resolve(addressed('t-2'));
      await run.promise;
    });
    await user.click(screen.getByRole('tab', { name: /^Threads/ }));
    expect(await screen.findByText(CHIP)).toBeInTheDocument();
    expect(claudeThreadCheck).toHaveBeenCalledTimes(1);

    // And the chip survives a further visit to Drafts.
    await user.click(screen.getByRole('tab', { name: /^Drafts/ }));
    await user.click(screen.getByRole('tab', { name: /^Threads/ }));
    expect(await screen.findByText(CHIP)).toBeInTheDocument();
    expect(claudeThreadCheck).toHaveBeenCalledTimes(1);
  });

  it('F-13.3 the button stays after a result: another click checks again and the result is replaced', async () => {
    const { claudeThreadCheck } = await openSummary({
      checks: [{ hints: [] }, addressed('t-2')],
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: CHECK }));
    expect(await screen.findByText(NONE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: CHECK }));
    expect(await screen.findByText(CHIP)).toBeInTheDocument();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(claudeThreadCheck).toHaveBeenCalledTimes(2);
  });

  it('F-13.3 the filters keep working with chips: Resolved shows no chip and All shows it again', async () => {
    await openSummary({ checks: [addressed('t-2')] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: CHECK }));
    await screen.findByText(CHIP);

    const group = screen.getByRole('group', { name: 'Thread filter' });
    await user.click(within(group).getByRole('button', { name: /^Resolved/ }));
    expect(chips()).toEqual([]);
    await user.click(within(group).getByRole('button', { name: 'All' }));
    expect(await screen.findByText(CHIP)).toBeInTheDocument();
  });
});
