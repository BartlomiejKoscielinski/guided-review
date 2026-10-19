import { act, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { createQueryClient } from '../../app/queryClient';
import { createAppRouter } from '../../app/router';
import type { IpcClient } from '../../ipc/client';
import { draftsKey } from '../../ipc/hooks/useDrafts';
import { IpcProvider } from '../../ipc/IpcProvider';
import { createMockClient } from '../../ipc/mock';
import type { Draft } from '../../ipc/types/Draft';
import type { Route } from '../../ipc/types/Route';
import type { Severity } from '../../ipc/types/Severity';
import { useFocusStore } from '../../state/focus';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-12.2: the tabs of S-05 of an MR session (SummaryDesk.dc.html, role="tablist" aria-label
// "Comments"): "Drafts N" and "Threads N open". N of Drafts is every draft of the session, the way
// the mock keeps "5" after a publish; N of Threads is the open resolvable threads of the MR (the
// mock's "3 open"). M5 decision 5: the screen opens on Drafts when the session has unpublished
// drafts, else on Threads, and the choice is kept while the screen is open. The plan row adds ARIA
// tabs with arrow keys. The lists under the tabs are F-12.3 and F-13.1, not tested here.
//
// !482's mock backend has no drafts and three open threads (d-482-1 to d-482-3), as the design
// mock's "Threads 3 open". The drafts are given to the screen through draftsList, so the tests
// do not depend on how a draft is made.

const MR_SESSION = 'mock-mr-session-1';
/** Commands that may run Claude or call GitLab; a restored S-05 calls none of them (F-30.4). */
const WORK = /^(review|gitlab|claude(?!Status$|Models$|Activity$))/;

/** The five drafts of the design mock (SummaryDesk.dc.html), severity and text. */
const MOCK_DRAFTS: ReadonlyArray<readonly [Severity, string]> = [
  [
    'fix',
    'Consider a separate catch (OperationCanceledException) without a message. Closing the camera isn’t a save error.',
  ],
  [
    'fix',
    'PendingCount doesn’t refresh after the worker uploads. Maybe a Changed event on IUploadQueue?',
  ],
  ['fix', 'Retries have no upper limit. On a permanent 4xx the photo will be retried forever.'],
  ['q', 'Did we consider saving the photo to disk and keeping only the path in the queue?'],
  ['nit', 'Nit: the banner has a fixed height. With a larger system font the text gets clipped.'],
];

/** The first `count` drafts of the mock, all ticked and not yet on GitLab; `over` changes some. */
function sessionDrafts(count: number, over: (index: number) => Partial<Draft> = () => ({})) {
  return MOCK_DRAFTS.slice(0, count).map(([severity, body], index): Draft => ({
    id: `mock-draft-${String(index + 1)}`,
    sessionId: MR_SESSION,
    findingId: null,
    body,
    position: null,
    severity,
    include: true,
    publishedNoteId: null,
    error: null,
    stepId: null,
    outdated: false,
    ...over(index),
  }));
}

/** The mock backend of an MR session whose plan is read, with some commands replaced. */
async function mrBackend(overrides: Partial<IpcClient> = {}): Promise<IpcClient> {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  return { ...base, ...overrides };
}

/** The whole app on `start`, with the query cache in reach to refresh a query like a mutation does. */
function mountApp(start: Route, client: IpcClient) {
  const router = createAppRouter(start);
  const queryClient = createQueryClient();
  render(
    <IpcProvider client={client}>
      <QueryClientProvider client={queryClient}>
        <App router={router} />
      </QueryClientProvider>
    </IpcProvider>,
  );
  return { router, queryClient };
}

/** S-05 of the MR session, opened the way Finish review does (not restored on start). */
async function openSummary(client: IpcClient) {
  const app = mountApp({ screen: 'S-01' }, client);
  await act(() => app.router.navigate(`/session/${MR_SESSION}/summary`));
  return app;
}

const tablist = () => screen.findByRole('tablist', { name: 'Comments' });
const tab = (name: string) => screen.findByRole('tab', { name });
const selectedTab = () => screen.getByRole('tab', { selected: true });
const isSelected = (element: HTMLElement) => element.getAttribute('aria-selected') === 'true';

describe('S-05 tabs of an MR session: Drafts N and Threads N open (F-12.2)', () => {
  it('F-12.2 the tabs read "Drafts 5" and "Threads 3 open" for the five drafts of the mock and the three open threads of !482', async () => {
    await openSummary(await mrBackend({ draftsList: () => Promise.resolve(sessionDrafts(5)) }));
    const list = await tablist();
    const drafts = await tab('Drafts 5');
    const threads = await tab('Threads 3 open');
    const tabs = within(list).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toBe(drafts);
    expect(tabs[1]).toBe(threads);
  });

  it('F-12.2 a session without drafts reads "Drafts 0", with the number', async () => {
    await openSummary(await mrBackend());
    expect(await tab('Drafts 0')).toBeInTheDocument();
    expect(await tab('Threads 3 open')).toBeInTheDocument();
  });

  it('F-12.2 Drafts counts every draft of the session, the unticked and the published ones too', async () => {
    const drafts = sessionDrafts(4, (index) => ({
      include: index !== 1,
      publishedNoteId: index === 2 ? 11 : null,
    }));
    await openSummary(await mrBackend({ draftsList: () => Promise.resolve(drafts) }));
    expect(await tab('Drafts 4')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Drafts [0-3]$/ })).toBeNull();
  });

  it.each([
    [1, 2],
    [2, 1],
    [3, 0],
  ])(
    'F-12.2 after %i of the 3 threads are resolved the tab reads "Threads %i open"',
    async (resolved, open) => {
      const backend = await mrBackend();
      for (const id of ['d-482-1', 'd-482-2', 'd-482-3'].slice(0, resolved)) {
        await backend.gitlabResolve(MR_SESSION, id, true);
      }
      await openSummary(backend);
      expect(await tab(`Threads ${String(open)} open`)).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Threads 3 open' })).toBeNull();
    },
  );
});

describe('S-05 opening tab (F-12.2, M5 decision 5)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out; give elements a size so the step screen's virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-12.2 a session with unpublished drafts opens on Drafts', async () => {
    await openSummary(await mrBackend({ draftsList: () => Promise.resolve(sessionDrafts(3)) }));
    expect(isSelected(await tab('Drafts 3'))).toBe(true);
    expect(isSelected(await tab('Threads 3 open'))).toBe(false);
    expect(selectedTab()).toHaveAccessibleName('Drafts 3');
  });

  it('F-12.2 a session without drafts opens on Threads', async () => {
    await openSummary(await mrBackend());
    expect(isSelected(await tab('Threads 3 open'))).toBe(true);
    expect(isSelected(await tab('Drafts 0'))).toBe(false);
  });

  it('F-12.2 a session whose drafts are all published opens on Threads, and Drafts still counts them', async () => {
    const published = sessionDrafts(2, (index) => ({ publishedNoteId: 20 + index }));
    await openSummary(await mrBackend({ draftsList: () => Promise.resolve(published) }));
    expect(isSelected(await tab('Threads 3 open'))).toBe(true);
    expect(isSelected(await tab('Drafts 2'))).toBe(false);
  });

  it('F-12.2 one unpublished draft among published ones is enough to open on Drafts', async () => {
    const mixed = sessionDrafts(3, (index) => ({
      publishedNoteId: index === 0 ? null : 30 + index,
    }));
    await openSummary(await mrBackend({ draftsList: () => Promise.resolve(mixed) }));
    expect(isSelected(await tab('Drafts 3'))).toBe(true);
    expect(isSelected(await tab('Threads 3 open'))).toBe(false);
  });

  it('F-12.2 while the drafts are being read no tab is selected, so the screen never shows the wrong tab first', async () => {
    // Reading (M5 decision 5 depends on the drafts): the choice waits for the answer, instead of
    // opening on Threads and jumping to Drafts, or the other way round.
    let answer: (drafts: Draft[]) => void = () => undefined;
    const pending = new Promise<Draft[]>((resolve) => {
      answer = resolve;
    });
    await openSummary(await mrBackend({ draftsList: () => pending }));
    expect(await screen.findByRole('button', { name: 'Back to steps' })).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(screen.queryAllByRole('tab', { selected: true })).toHaveLength(0);

    await act(async () => {
      answer(sessionDrafts(2));
      await pending;
    });
    expect(isSelected(await tab('Drafts 2'))).toBe(true);
    expect(selectedTab()).toHaveAccessibleName('Drafts 2');
  });

  it('F-12.2 a drafts list read before the screen opened does not decide the tab: right after Add to drafts the summary opens on Drafts', async () => {
    // Add to drafts shows its card before the drafts are read again, so Finish review can open the
    // summary while that read still runs and the cache holds the list from before the draft.
    let answer: (drafts: Draft[]) => void = () => undefined;
    const late = new Promise<Draft[]>((resolve) => {
      answer = resolve;
    });
    const client = await mrBackend({ draftsList: () => late });
    const { router, queryClient } = mountApp({ screen: 'S-01' }, client);
    queryClient.setQueryData(draftsKey(MR_SESSION), []);
    // The read Add to drafts started is still running when the summary opens.
    queryClient
      .query({
        queryKey: draftsKey(MR_SESSION),
        queryFn: () => client.draftsList(MR_SESSION),
        staleTime: 0,
      })
      .catch(() => undefined);
    await act(() => router.navigate(`/session/${MR_SESSION}/summary`));
    expect(await screen.findByRole('button', { name: 'Back to steps' })).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(screen.queryAllByRole('tab', { selected: true })).toHaveLength(0);

    await act(async () => {
      answer(sessionDrafts(1));
      await late;
    });
    expect(isSelected(await tab('Drafts 1'))).toBe(true);
    expect(isSelected(await tab('Threads 3 open'))).toBe(false);
  });

  it('F-12.2 when the drafts cannot be read the tabs still show: "Drafts" without a number (never "Drafts 0"), opened on Drafts', async () => {
    // Reading: a number would claim there is nothing to publish; the failure belongs to the
    // Drafts list (F-12.3), so that is the tab the user lands on.
    await openSummary(
      await mrBackend({
        draftsList: () => Promise.reject(new Error('The drafts could not be read.')),
      }),
    );
    const drafts = await tab('Drafts');
    expect(isSelected(drafts)).toBe(true);
    expect(screen.queryByRole('tab', { name: 'Drafts 0' })).toBeNull();
    expect(await tab('Threads 3 open')).toBeInTheDocument();
  });

  it('F-12.2 the count follows the drafts while the screen is open, the tab does not: Threads stays when a draft arrives', async () => {
    let current: Draft[] = [];
    const { queryClient } = await openSummary(
      await mrBackend({ draftsList: () => Promise.resolve(current) }),
    );
    expect(isSelected(await tab('Threads 3 open'))).toBe(true);

    current = sessionDrafts(2);
    await act(() => queryClient.invalidateQueries({ queryKey: draftsKey(MR_SESSION) }));
    expect(await tab('Drafts 2')).toBeInTheDocument();
    expect(selectedTab()).toHaveAccessibleName('Threads 3 open');
  });

  it('F-12.2 Drafts stays selected when its drafts are published meanwhile, so the published rows stay in view', async () => {
    let current = sessionDrafts(2);
    const { queryClient } = await openSummary(
      await mrBackend({ draftsList: () => Promise.resolve(current) }),
    );
    expect(isSelected(await tab('Drafts 2'))).toBe(true);

    current = sessionDrafts(2, (index) => ({ publishedNoteId: 40 + index }));
    await act(() => queryClient.invalidateQueries({ queryKey: draftsKey(MR_SESSION) }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(selectedTab()).toHaveAccessibleName('Drafts 2');
  });

  it('F-12.2 the tab the user picked is kept when the drafts are read again', async () => {
    const user = userEvent.setup();
    const current = sessionDrafts(2);
    const { queryClient } = await openSummary(
      await mrBackend({ draftsList: () => Promise.resolve([...current]) }),
    );
    await user.click(await tab('Threads 3 open'));
    expect(selectedTab()).toHaveAccessibleName('Threads 3 open');

    await act(() => queryClient.invalidateQueries({ queryKey: draftsKey(MR_SESSION) }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(selectedTab()).toHaveAccessibleName('Threads 3 open');
  });

  it('F-12.2 the choice lasts only while the screen is open: coming back to the summary picks the tab again', async () => {
    const user = userEvent.setup();
    const { router } = await openSummary(
      await mrBackend({ draftsList: () => Promise.resolve(sessionDrafts(2)) }),
    );
    await user.click(await tab('Threads 3 open'));
    expect(selectedTab()).toHaveAccessibleName('Threads 3 open');

    await user.click(screen.getByRole('button', { name: 'Back to steps' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/session/${MR_SESSION}/step`);
    });
    expect(await screen.findByText(/^Step \d of 8$/)).toBeInTheDocument();
    await user.click(
      within(screen.getByTestId('title-bar')).getByRole('button', { name: 'Finish review' }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/session/${MR_SESSION}/summary`);
    });
    expect(isSelected(await tab('Drafts 2'))).toBe(true);
  });
});

describe('S-05 tabs as ARIA tabs with arrow keys (F-12.2)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
  });

  it('F-12.2 the tablist is named Comments, one tab is selected and only that tab is in the Tab order', async () => {
    await openSummary(await mrBackend({ draftsList: () => Promise.resolve(sessionDrafts(5)) }));
    await tablist();
    const drafts = await tab('Drafts 5');
    const threads = await tab('Threads 3 open');
    expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
    expect(selectedTab()).toBe(drafts);
    expect(drafts).toHaveAttribute('tabindex', '0');
    expect(threads).toHaveAttribute('tabindex', '-1');
  });

  it('F-12.2 clicking a tab selects it and moves the Tab stop with it', async () => {
    const user = userEvent.setup();
    await openSummary(await mrBackend({ draftsList: () => Promise.resolve(sessionDrafts(5)) }));
    const drafts = await tab('Drafts 5');
    const threads = await tab('Threads 3 open');

    await user.click(threads);
    expect(isSelected(threads)).toBe(true);
    expect(isSelected(drafts)).toBe(false);
    expect(threads).toHaveAttribute('tabindex', '0');
    expect(drafts).toHaveAttribute('tabindex', '-1');

    await user.click(drafts);
    expect(isSelected(drafts)).toBe(true);
    expect(isSelected(threads)).toBe(false);
  });

  it('F-12.2 ArrowRight and ArrowLeft select the other tab and focus it, wrapping at both ends', async () => {
    const user = userEvent.setup();
    await openSummary(await mrBackend({ draftsList: () => Promise.resolve(sessionDrafts(5)) }));
    const drafts = await tab('Drafts 5');
    const threads = await tab('Threads 3 open');
    act(() => {
      drafts.focus();
    });

    await user.keyboard('{ArrowRight}');
    expect(isSelected(threads)).toBe(true);
    expect(threads).toHaveFocus();
    expect(isSelected(drafts)).toBe(false);

    await user.keyboard('{ArrowRight}');
    expect(isSelected(drafts)).toBe(true);
    expect(drafts).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(isSelected(threads)).toBe(true);
    expect(threads).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(isSelected(drafts)).toBe(true);
    expect(drafts).toHaveFocus();
  });

  it('F-12.2 End selects the last tab and Home the first', async () => {
    const user = userEvent.setup();
    await openSummary(await mrBackend({ draftsList: () => Promise.resolve(sessionDrafts(5)) }));
    const drafts = await tab('Drafts 5');
    const threads = await tab('Threads 3 open');
    act(() => {
      drafts.focus();
    });

    await user.keyboard('{End}');
    expect(isSelected(threads)).toBe(true);
    expect(threads).toHaveFocus();

    await user.keyboard('{Home}');
    expect(isSelected(drafts)).toBe(true);
    expect(drafts).toHaveFocus();
  });
});

// S-05 restored on start (ui.lastRoute): restoring never starts Claude or GitLab work (F-30.4).
// The drafts are on this PC, so "Drafts N" shows; the open threads are on GitLab, so the Threads
// tab shows without a number, never "Threads 0 open", until the summary is opened again.

describe('S-05 tabs restored on start (F-12.2, F-30.4)', () => {
  it('F-12.2 F-30.4 a restored S-05 reads "Drafts 2" from the local drafts and a bare "Threads", and calls no GitLab command', async () => {
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    await base.reviewPlan(MR_SESSION, () => undefined);
    const { client, calls } = recordingClient(base);
    const { router } = renderApp(
      { screen: 'S-05', sessionId: MR_SESSION },
      { ...client, draftsList: () => Promise.resolve(sessionDrafts(2)) },
    );
    expect(router.state.location.state).toEqual({ restored: true });

    const drafts = await tab('Drafts 2');
    expect(isSelected(drafts)).toBe(true);
    const threads = await tab('Threads');
    expect(isSelected(threads)).toBe(false);
    expect(screen.queryByRole('tab', { name: /open/ })).toBeNull();
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
  });

  it('F-12.2 F-30.4 a restored S-05 of a session without drafts opens on the bare Threads tab', async () => {
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    await base.reviewPlan(MR_SESSION, () => undefined);
    const { client, calls } = recordingClient(base);
    renderApp({ screen: 'S-05', sessionId: MR_SESSION }, client);

    expect(isSelected(await tab('Threads'))).toBe(true);
    expect(await tab('Drafts 0')).toBeInTheDocument();
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
  });
});
