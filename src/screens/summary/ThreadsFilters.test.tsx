import { act, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { createQueryClient } from '../../app/queryClient';
import { createAppRouter } from '../../app/router';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { IpcProvider } from '../../ipc/IpcProvider';
import { createMockClient } from '../../ipc/mock';
import type { Thread } from '../../ipc/types/Thread';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-13.1: the Threads tab of S-05 (SummaryDesk.dc.html) has the filters All / Open N / Resolved N,
// a group "Thread filter" of buttons with aria-pressed in the tab bar's row, and under the tabs
// the list of the MR's resolvable threads (M5 decision 13: a comment on the MR itself that can't
// be resolved is not listed and counted in neither number). Open N is the N of "Threads N open";
// Resolved N the resolvable threads that are resolved; All has no number. "No threads in this
// view." stands in the list when the pick has no thread.
//
// Locators the screen keeps: the group (role group, name "Thread filter") with the three buttons
// named exactly "All", "Open 3", "Resolved 2" in that order; the list inside the tab panel
// (role tabpanel) showing each thread's first message as its own plain text node (F-13.2 adds
// author, replies, file:line and Resolve / Reopen around it). The five threads are the design
// mock's (3 open, 2 resolved), plus one comment on the MR itself.
//
// Decisions locked here (tests stage, M5 / F-13.1): the pick is kept when the user switches to
// Drafts and back (the mock holds `filter` next to `tab`); the Drafts tab has no filters; while
// the threads are being read, and when the read failed, no button claims a count ("Open 0") and
// a failure shows the IpcError's message as a role=alert in the panel, as the Drafts tab does
// (F-12.3); a summary restored on start does not read the threads (F-30.4), so a restored panel
// on Threads says "Open the summary again to load the threads." instead of standing empty.

const MR_SESSION = 'mock-mr-session-1';
/** Commands that may run Claude or call GitLab; a restored S-05 calls none of them (F-30.4). */
const WORK = /^(review|gitlab|claude(?!Status$|Models$|Activity$))/;

const KICK = 'Kick() is called on the UI thread. Does the worker block anything here?';
const INDEX = 'No index on CreatedAt, but every read sorts by it.';
const NETWORK = 'Do we need ACCESS_NETWORK_STATE here?';
const BANNER = 'Banner color should come from resources, not be hardcoded.';
const RECORD = 'Maybe a record instead of a class?';
const GENERAL = 'Thanks for the quick turnaround on this one.';

const OPEN_BODIES = [KICK, INDEX, NETWORK] as const;
const RESOLVED_BODIES = [BANNER, RECORD] as const;
const ALL_BODIES = [...OPEN_BODIES, ...RESOLVED_BODIES, GENERAL] as const;

let noteId = 0;
const thread = (id: string, body: string, state: 'open' | 'resolved' | 'general'): Thread => ({
  id,
  resolvable: state !== 'general',
  resolved: state === 'resolved',
  outdated: false,
  notes: [
    {
      id: (noteId += 1),
      author: { username: 'pawel.s', name: 'Paweł S.' },
      body,
      createdAt: '2026-10-12T09:14:00.000Z',
    },
  ],
});

/** The design mock's five threads (3 open, 2 resolved) and a comment on the MR itself. */
const mockThreads = (): Thread[] => [
  thread('t-1', KICK, 'open'),
  thread('t-2', INDEX, 'open'),
  thread('t-3', NETWORK, 'open'),
  thread('t-4', BANNER, 'resolved'),
  thread('t-5', RECORD, 'resolved'),
  thread('t-g', GENERAL, 'general'),
];

/** S-05 of the MR session without drafts, opened the way Finish review does: on Threads. */
async function openSummary(threads: Thread[] | Promise<Thread[]>) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  const gitlabDiscussions: IpcClient['gitlabDiscussions'] = () => Promise.resolve(threads);
  const router = createAppRouter({ screen: 'S-01' });
  render(
    <IpcProvider client={{ ...base, gitlabDiscussions }}>
      <QueryClientProvider client={createQueryClient()}>
        <App router={router} />
      </QueryClientProvider>
    </IpcProvider>,
  );
  await act(() => router.navigate(`/session/${MR_SESSION}/summary`));
}

const filterGroup = () => screen.findByRole('group', { name: 'Thread filter' });
const filter = async (name: string) => within(await filterGroup()).getByRole('button', { name });
const panel = () => within(screen.getByRole('tabpanel'));

/** Exactly these first messages are listed, of the six the fixture has. */
function expectListed(bodies: readonly string[]) {
  for (const body of ALL_BODIES) {
    if (bodies.includes(body)) expect(panel().getByText(body)).toBeInTheDocument();
    else expect(panel().queryByText(body)).toBeNull();
  }
}

describe('S-05 Threads tab filters (F-13.1)', () => {
  it('F-13.1 the Threads tab has the filters All, Open 3 and Resolved 2 in that order, All pressed', async () => {
    await openSummary(mockThreads());
    const group = await filterGroup();
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['All', 'Open 3', 'Resolved 2']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
  });

  it('F-13.1 Open N is the N of the tab "Threads N open": a comment on the MR itself is in neither', async () => {
    await openSummary(mockThreads());
    expect(await screen.findByRole('tab', { name: 'Threads 3 open' })).toBeInTheDocument();
    expect(await filter('Open 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open 4' })).toBeNull();
  });

  it('F-13.1 All lists every resolvable thread by its first message, not the comment on the MR itself', async () => {
    await openSummary(mockThreads());
    await filterGroup();
    expectListed([...OPEN_BODIES, ...RESOLVED_BODIES]);
  });

  it('F-13.1 Open shows only the open threads and is the pressed filter', async () => {
    const user = userEvent.setup();
    await openSummary(mockThreads());
    await user.click(await filter('Open 3'));
    expect(await filter('Open 3')).toHaveAttribute('aria-pressed', 'true');
    expect(await filter('All')).toHaveAttribute('aria-pressed', 'false');
    expect(await filter('Resolved 2')).toHaveAttribute('aria-pressed', 'false');
    expectListed(OPEN_BODIES);
  });

  it('F-13.1 Resolved shows only the resolved threads and is the pressed filter', async () => {
    const user = userEvent.setup();
    await openSummary(mockThreads());
    await user.click(await filter('Resolved 2'));
    expect(await filter('Resolved 2')).toHaveAttribute('aria-pressed', 'true');
    expect(await filter('All')).toHaveAttribute('aria-pressed', 'false');
    expect(await filter('Open 3')).toHaveAttribute('aria-pressed', 'false');
    expectListed(RESOLVED_BODIES);
  });

  it('F-13.1 All brings every thread back after Open or Resolved; the numbers do not change with the pick', async () => {
    const user = userEvent.setup();
    await openSummary(mockThreads());
    await user.click(await filter('Resolved 2'));
    await user.click(await filter('Open 3'));
    await user.click(await filter('All'));
    expect(await filter('All')).toHaveAttribute('aria-pressed', 'true');
    expect(await filter('Open 3')).toHaveAttribute('aria-pressed', 'false');
    expect(await filter('Resolved 2')).toHaveAttribute('aria-pressed', 'false');
    expectListed([...OPEN_BODIES, ...RESOLVED_BODIES]);
  });

  it('F-13.1 a pick with no thread says "No threads in this view." and All lists them again', async () => {
    const user = userEvent.setup();
    await openSummary([thread('t-1', KICK, 'open'), thread('t-2', INDEX, 'open')]);
    expect(screen.queryByText('No threads in this view.')).toBeNull();
    await user.click(await filter('Resolved 0'));
    expect(await screen.findByText('No threads in this view.')).toBeInTheDocument();
    expect(panel().queryByText(KICK)).toBeNull();
    expect(panel().queryByText(INDEX)).toBeNull();
    await user.click(await filter('All'));
    expect(screen.queryByText('No threads in this view.')).toBeNull();
    expect(panel().getByText(KICK)).toBeInTheDocument();
  });

  it('F-13.1 Open with every thread resolved says "No threads in this view."', async () => {
    const user = userEvent.setup();
    await openSummary([thread('t-4', BANNER, 'resolved'), thread('t-5', RECORD, 'resolved')]);
    await user.click(await filter('Open 0'));
    expect(await screen.findByText('No threads in this view.')).toBeInTheDocument();
    expect(panel().queryByText(BANNER)).toBeNull();
  });

  it('F-13.1 an MR with no resolvable thread has All, Open 0 and Resolved 0 and says "No threads in this view."', async () => {
    await openSummary([thread('t-g', GENERAL, 'general')]);
    expect(await filter('All')).toHaveAttribute('aria-pressed', 'true');
    expect(await filter('Open 0')).toBeInTheDocument();
    expect(await filter('Resolved 0')).toBeInTheDocument();
    expect(await screen.findByText('No threads in this view.')).toBeInTheDocument();
    expect(panel().queryByText(GENERAL)).toBeNull();
  });

  it('F-13.1 the filters belong to the Threads tab, and the pick is kept when the user goes to Drafts and back', async () => {
    const user = userEvent.setup();
    await openSummary(mockThreads());
    await user.click(await filter('Resolved 2'));

    await user.click(screen.getByRole('tab', { name: /^Drafts/ }));
    expect(screen.queryByRole('group', { name: 'Thread filter' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^(All|Open \d+|Resolved \d+)$/ })).toBeNull();

    await user.click(screen.getByRole('tab', { name: /^Threads/ }));
    expect(await filter('Resolved 2')).toHaveAttribute('aria-pressed', 'true');
    expectListed(RESOLVED_BODIES);
  });
});

describe('S-05 Threads tab while the threads are read or cannot be (F-13.1, F-12.2)', () => {
  it('F-13.1 until GitLab answers no filter claims a number, then Open 3 and Resolved 2 appear', async () => {
    let release: (threads: Thread[]) => void = () => undefined;
    const answer = new Promise<Thread[]>((resolve) => {
      release = resolve;
    });
    await openSummary(answer);
    const tab = await screen.findByRole('tab', { name: 'Threads' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: /^(Open|Resolved)/ })).toBeNull();

    await act(() => {
      release(mockThreads());
      return Promise.resolve();
    });
    expect(await filter('Open 3')).toBeInTheDocument();
    expect(await filter('Resolved 2')).toBeInTheDocument();
  });

  it('F-13.1 when GitLab cannot be read the panel shows the message as an alert, with no filter and no "Open 0"', async () => {
    const failure = new IpcError({
      code: 'GITLAB_UNREACHABLE',
      message: "GitLab can't be reached.",
      retryable: true,
    });
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    await base.reviewPlan(MR_SESSION, () => undefined);
    const router = createAppRouter({ screen: 'S-01' });
    render(
      <IpcProvider client={{ ...base, gitlabDiscussions: () => Promise.reject(failure) }}>
        <QueryClientProvider client={createQueryClient()}>
          <App router={router} />
        </QueryClientProvider>
      </IpcProvider>,
    );
    await act(() => router.navigate(`/session/${MR_SESSION}/summary`));

    const alert = await within(await screen.findByRole('tabpanel')).findByRole('alert');
    expect(alert).toHaveTextContent("GitLab can't be reached.");
    expect(screen.queryByRole('group', { name: 'Thread filter' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Open|Resolved)/ })).toBeNull();
    expect(screen.queryByText('No threads in this view.')).toBeNull();
  });
});

describe('S-05 Threads tab restored on start (F-13.1, F-30.4)', () => {
  it('F-13.1 F-30.4 a restored summary that opens on Threads reads no thread, shows no filter and says to open the summary again', async () => {
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    await base.reviewPlan(MR_SESSION, () => undefined);
    const { client, calls } = recordingClient(base);
    const app = renderApp({ screen: 'S-05', sessionId: MR_SESSION }, client);
    expect(app.router.state.location.state).toEqual({ restored: true });

    const tab = await screen.findByRole('tab', { name: 'Threads' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(
      await within(screen.getByRole('tabpanel')).findByText(
        'Open the summary again to load the threads.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Thread filter' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Open|Resolved)/ })).toBeNull();
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
  });
});
