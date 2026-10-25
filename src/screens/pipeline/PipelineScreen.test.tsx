import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import type { SessionMr } from '../../ipc/types/SessionMr';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-20.1: S-08 Pipeline (Pipeline.dc.html, M6 decisions 1 to 4). Against the mock backend's !482
// (#18342 Passed with 1 allowed failure, #18321 Failed, #18320 Canceled) and against replaced
// `pipelineList(project, iid)` / `pipelineGet(project, iid, id)` answers for the rest.
//
// Locators the screen keeps:
//  - <h1> "Pipeline" and a link "Back to review" / "Back to MRs" (decision 4).
//  - <div role="tablist" aria-label="Pipelines for this MR"> with one <button role="tab"> per
//    pipeline, newest first, whose text is "#18342" then "version 3 · latest" (two spans; the
//    status dot is aria-hidden and the tab has no other text before the number); aria-selected on
//    the shown one; roving tabindex (only the selected tab is in the Tab order).
//  - data-testid="pipeline-status": the status word of the selected pipeline ("Passed", "Failed",
//    "Running", "Waiting", "Canceled", "Skipped", "Manual"), in that exact case (CSS uppercases).
//  - data-testid="pipeline-allowed": the tag "1 allowed failure" / "2 allowed failures"; absent
//    when the count is 0.
//  - data-testid="pipeline-meta": the meta line. It holds, as separate elements, "#18342", the
//    kind, the 7-char SHA, and last the text "version 3 · Marta K. · 2 h ago · 14 min".
//  - a region of the screen "No pipeline for this MR yet." (a <p>) with the button "Run new
//    pipeline" when the MR has none; a failed read as role="alert" holding the error message.

const PROJECT = 'mobile/mobile-app';
const IID = 482;
/** Commands that may run Claude or call GitLab; a restored screen calls none of them (F-30.4). */
const WORK = /^(review|gitlab|pipeline|claude(?!Status$|Models$|Activity$))/;

type Tab = Awaited<ReturnType<IpcClient['pipelineList']>>[number];
type Head = Awaited<ReturnType<IpcClient['pipelineGet']>>;

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const sha = (short: string) => short.padEnd(40, '0');

const tab = (over: Partial<Tab>): Tab => ({
  id: 18342,
  number: 18342,
  sha: sha('a3f9c12'),
  version: 3,
  latest: true,
  status: 'passed',
  ...over,
});

const head = (over: Partial<Head>): Head => ({
  status: 'passed',
  allowedFailures: 0,
  number: 18342,
  kind: 'Merge request pipeline',
  sha: sha('a3f9c12'),
  version: 3,
  author: 'Marta K.',
  startedByMe: false,
  startedAt: ago(2 * HOUR),
  durationSecs: 14 * 60,
  webUrl: 'https://gitlab.local/mobile/mobile-app/-/pipelines/18342',
  ...over,
});

async function backend(override: Partial<IpcClient> = {}) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  return recordingClient({ ...base, ...override });
}

/** S-01, then the pipeline of !482 opened by navigation (not as a restored start). */
async function openPipeline(override: Partial<IpcClient> = {}) {
  const rec = await backend(override);
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: IID })));
  return { ...app, ...rec };
}

const status = () => screen.findByTestId('pipeline-status');
const strip = () => screen.findByRole('tablist', { name: 'Pipelines for this MR' });
const meta = () => screen.getByTestId('pipeline-meta');

/** One pipeline answered by hand: its tab and its head. */
function only(tabOver: Partial<Tab>, headOver: Partial<Head>): Partial<IpcClient> {
  return {
    pipelineList: () => Promise.resolve([tab(tabOver)]),
    pipelineGet: () => Promise.resolve(head(headOver)),
  };
}

describe('S-08 Pipeline tabs and status block (F-20.1)', () => {
  it('F-20.1 the page has the heading PIPELINE and one tab per pipeline, newest first, "version N · latest" on the newest only', async () => {
    await openPipeline();

    expect(await screen.findByRole('heading', { level: 1, name: 'Pipeline' })).toBeInTheDocument();
    const tabs = within(await strip()).getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent(/^#18342\s*version 3 · latest/);
    expect(tabs[1]).toHaveTextContent(/^#18321\s*version 2/);
    expect(tabs[1]).not.toHaveTextContent('latest');
    expect(tabs[2]).toHaveTextContent(/^#18320\s*version 2/);
    expect(tabs[2]).not.toHaveTextContent('latest');
  });

  it('F-20.1 reads the pipelines of the active repository’s project and the MR from the route, then the head of the newest', async () => {
    const pipelineList = vi.fn<IpcClient['pipelineList']>(() =>
      Promise.resolve([tab({}), tab({ id: 18321, number: 18321, latest: false })]),
    );
    const pipelineGet = vi.fn<IpcClient['pipelineGet']>(() => Promise.resolve(head({})));
    await openPipeline({ pipelineList, pipelineGet });

    await status();

    expect(pipelineList).toHaveBeenCalledWith(PROJECT, IID);
    expect(pipelineGet).toHaveBeenCalledWith(PROJECT, IID, 18342);
    expect(pipelineGet).not.toHaveBeenCalledWith(PROJECT, IID, 18321);
  });

  it('F-20.1 the page opens on the newest pipeline: its tab is selected and the block says Passed, 1 allowed failure', async () => {
    await openPipeline();

    const tabs = within(await strip()).getAllByRole('tab');
    await waitFor(() => {
      expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    });
    expect(await status()).toHaveTextContent(/^Passed$/);
    expect(screen.getByTestId('pipeline-allowed')).toHaveTextContent(/^1 allowed failure$/);
  });

  it('F-20.1 the meta line gives the number, the kind, the SHA, the version, the author, the age and the duration', async () => {
    await openPipeline();

    await status();
    const line = within(meta());
    expect(line.getByText('#18342')).toBeInTheDocument();
    expect(line.getByText('Merge request pipeline')).toBeInTheDocument();
    expect(line.getByText('a3f9c12')).toBeInTheDocument();
    expect(line.getByText('version 3 · Marta K. · 2 h ago · 14 min')).toBeInTheDocument();
  });

  it('F-20.1 picking the second tab shows that pipeline: Failed, no allowed-failure tag, its own SHA and meta', async () => {
    const user = userEvent.setup();
    const { calls } = await openPipeline();
    await status();

    await user.click(within(await strip()).getByRole('tab', { name: /#18321/ }));

    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent(/^Failed$/);
    });
    expect(screen.queryByTestId('pipeline-allowed')).toBeNull();
    const line = within(meta());
    expect(line.getByText('#18321')).toBeInTheDocument();
    expect(line.getByText('6a02f9e')).toBeInTheDocument();
    expect(line.getByText('version 2 · Marta K. · 3 h ago · 9 min')).toBeInTheDocument();
    expect(line.queryByText('a3f9c12')).toBeNull();
    expect(screen.getByRole('tab', { name: /#18321/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /#18342/ })).toHaveAttribute('aria-selected', 'false');
    expect(calls.filter((c) => c === 'pipelineGet').length).toBeGreaterThanOrEqual(2);
  });

  it('F-20.1 a canceled pipeline says only what GitLab reports: Canceled, no duration, no "canceled by a newer push"', async () => {
    const user = userEvent.setup();
    await openPipeline();
    await status();

    await user.click(within(await strip()).getByRole('tab', { name: /#18320/ }));

    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent(/^Canceled$/);
    });
    expect(within(meta()).getByText('version 2 · Marta K. · 3 h ago')).toBeInTheDocument();
    expect(screen.queryByText(/canceled by a newer push/i)).toBeNull();
  });

  it('F-20.1 the arrow keys move between the tabs and show the pipeline of the focused one (wrapping at both ends)', async () => {
    const user = userEvent.setup();
    await openPipeline();
    await status();
    const tabs = within(await strip()).getAllByRole('tab');
    const selected = () => tabs.map((t) => t.getAttribute('aria-selected'));
    act(() => {
      tabs[0]?.focus();
    });

    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
    expect(selected()).toEqual(['false', 'true', 'false']);
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent(/^Failed$/);
    });

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(tabs[0]).toHaveFocus();
    expect(selected()).toEqual(['true', 'false', 'false']);

    await user.keyboard('{ArrowLeft}');
    expect(tabs[2]).toHaveFocus();
    expect(selected()).toEqual(['false', 'false', 'true']);
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent(/^Canceled$/);
    });
  });

  it('F-20.1 only the selected tab is in the Tab order', async () => {
    await openPipeline();
    await status();

    const tabs = within(await strip()).getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });
});

describe('S-08 status words and the allowed-failure tag (F-20.1)', () => {
  const WORDS: [Head['status'], string][] = [
    ['passed', 'Passed'],
    ['failed', 'Failed'],
    ['running', 'Running'],
    ['waiting', 'Waiting'],
    ['canceled', 'Canceled'],
    ['skipped', 'Skipped'],
    ['manual', 'Manual'],
  ];

  it.each(WORDS)(
    'F-20.1 a %s pipeline shows the word %s in the status block',
    async (state, word) => {
      await openPipeline(only({ status: state }, { status: state }));

      expect(await status()).toHaveTextContent(new RegExp(`^${word}$`));
    },
  );

  it('F-20.1 one allowed failure reads "1 allowed failure", two read "2 allowed failures"', async () => {
    const one = await openPipeline(only({}, { allowedFailures: 1 }));
    expect(await screen.findByTestId('pipeline-allowed')).toHaveTextContent(/^1 allowed failure$/);
    one.unmount();

    await openPipeline(only({}, { allowedFailures: 2 }));
    expect(await screen.findByTestId('pipeline-allowed')).toHaveTextContent(/^2 allowed failures$/);
  });

  it('F-20.1 no allowed failures, no tag', async () => {
    await openPipeline(only({}, { allowedFailures: 0 }));

    await status();
    expect(screen.queryByTestId('pipeline-allowed')).toBeNull();
    expect(screen.queryByText(/allowed failure/)).toBeNull();
  });
});

describe('S-08 meta line (F-20.1, decision 3)', () => {
  it('F-20.1 the user’s own pipeline says "started by you" in place of the author', async () => {
    await openPipeline(
      only(
        { status: 'running' },
        { status: 'running', startedByMe: true, startedAt: ago(5_000), durationSecs: null },
      ),
    );

    await status();
    expect(within(meta()).getByText('version 3 · started by you · just now')).toBeInTheDocument();
  });

  it('F-20.1 a running pipeline has no duration yet', async () => {
    await openPipeline(
      only(
        { status: 'running' },
        { status: 'running', durationSecs: null, startedAt: ago(3 * HOUR) },
      ),
    );

    await status();
    expect(within(meta()).getByText('version 3 · Marta K. · 3 h ago')).toBeInTheDocument();
  });

  it('F-20.1 durations read "45 s", "14 min" and "1 h 5 min"', async () => {
    const seconds = await openPipeline(only({}, { durationSecs: 45 }));
    await status();
    expect(within(meta()).getByText('version 3 · Marta K. · 2 h ago · 45 s')).toBeInTheDocument();
    seconds.unmount();

    const hour = await openPipeline(only({}, { durationSecs: 3900 }));
    await status();
    expect(
      within(meta()).getByText('version 3 · Marta K. · 2 h ago · 1 h 5 min'),
    ).toBeInTheDocument();
    hour.unmount();
  });

  it('F-20.1 a SHA in no MR version leaves the version out of the tab and of the meta line', async () => {
    await openPipeline({
      pipelineList: () =>
        Promise.resolve([
          tab({ id: 18343, number: 18343, version: null, latest: true }),
          tab({ id: 18342, number: 18342, version: 3, latest: false }),
          tab({ id: 18341, number: 18341, version: null, latest: false }),
        ]),
      pipelineGet: () => Promise.resolve(head({ number: 18343, version: null })),
    });

    const tabs = within(await strip()).getAllByRole('tab');
    // The newest pipeline without a version reads only "latest"; an older one reads only its number.
    expect(tabs[0]).toHaveTextContent(/^#18343\s*latest/);
    expect(tabs[0]).not.toHaveTextContent('version');
    expect(tabs[1]).toHaveTextContent(/^#18342\s*version 3/);
    expect(tabs[2]).not.toHaveTextContent(/version|latest/);
    await status();
    expect(within(meta()).getByText('Marta K. · 2 h ago · 14 min')).toBeInTheDocument();
  });
});

describe('S-08 without pipelines, while loading, on errors and restored (F-20.1)', () => {
  it('F-20.1 an MR without pipelines says "No pipeline for this MR yet." and offers Run new pipeline', async () => {
    await openPipeline({ pipelineList: () => Promise.resolve([]) });

    expect(await screen.findByText('No pipeline for this MR yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run new pipeline' })).toBeEnabled();
    expect(screen.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByTestId('pipeline-status')).toBeNull();
  });

  it('F-20.1 an MR with pipelines does not say "No pipeline for this MR yet."', async () => {
    await openPipeline();

    await status();
    expect(screen.queryByText('No pipeline for this MR yet.')).toBeNull();
  });

  it('F-20.1 while the list loads, nothing is claimed: no tabs, no status, not "No pipeline for this MR yet."', async () => {
    await openPipeline({ pipelineList: () => new Promise(() => undefined) });

    // The page frame is there from the start: heading, back link and the action to run a pipeline.
    expect(await screen.findByRole('heading', { level: 1, name: 'Pipeline' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Back to MRs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run new pipeline' })).toBeInTheDocument();
    expect(screen.queryByText('No pipeline for this MR yet.')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByTestId('pipeline-status')).toBeNull();
  });

  it('F-20.1 while the head loads, the tabs show but the block claims no status', async () => {
    await openPipeline({ pipelineGet: () => new Promise(() => undefined) });

    expect(within(await strip()).getAllByRole('tab')).toHaveLength(3);
    expect(screen.queryByTestId('pipeline-status')).toBeNull();
    expect(screen.queryByTestId('pipeline-meta')).toBeNull();
  });

  it('F-20.1 a failed list read shows the error as an alert, not "No pipeline for this MR yet."', async () => {
    await openPipeline({
      pipelineList: () =>
        Promise.reject(
          new IpcError({
            code: 'GITLAB_UNREACHABLE',
            message: 'GitLab can’t be reached.',
            retryable: true,
          }),
        ),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('GitLab can’t be reached.');
    expect(screen.queryByText('No pipeline for this MR yet.')).toBeNull();
    expect(screen.queryByTestId('pipeline-status')).toBeNull();
  });

  it('F-20.1 a failed head read keeps the tabs and shows the error as an alert instead of a status', async () => {
    await openPipeline({
      pipelineGet: () =>
        Promise.reject(
          new IpcError({
            code: 'GITLAB_FORBIDDEN',
            message: 'GitLab refused: 403 Forbidden.',
            retryable: false,
          }),
        ),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('GitLab refused: 403 Forbidden.');
    expect(within(await strip()).getAllByRole('tab')).toHaveLength(3);
    expect(screen.queryByTestId('pipeline-status')).toBeNull();
  });

  it('F-20.1 a restored start (F-30.4) reads no pipeline and no GitLab: it asks to open the pipeline again', async () => {
    const rec = await backend();
    renderApp({ screen: 'S-08', iid: IID }, rec.client);

    expect(await screen.findByRole('heading', { level: 1, name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByText('Open the pipeline again to load it.')).toBeInTheDocument();
    expect(screen.queryByText('No pipeline for this MR yet.')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    await waitFor(() => {
      expect(rec.calls).toContain('sessionsListUnfinished');
    });
    expect(rec.calls.filter((name) => WORK.test(name))).toEqual([]);
  });
});

describe('S-08 back link (M6 decision 4)', () => {
  const SESSION: SessionMr = {
    mr: {
      iid: IID,
      title: 'Offline queue for delivery photos',
      author: 'Marta K.',
      sourceBranch: 'feature/offline-upload',
      targetBranch: 'develop',
      pipeline: 'passed',
    },
    groups: [],
    totalFiles: 16,
    additions: 462,
    deletions: 61,
    commits: 3,
  };

  it('F-20.1 opened from a review screen, the link reads "Back to review" and goes back to that screen', async () => {
    const user = userEvent.setup();
    const rec = await backend({ sessionMr: () => Promise.resolve(SESSION) });
    const app = renderApp({ screen: 'S-02', sessionId: 's1' }, rec.client);

    await user.click(await screen.findByRole('link', { name: /pipeline passed/i }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Pipeline' })).toBeInTheDocument();
    expect(app.router.state.location.pathname).toBe(pathFor({ screen: 'S-08', iid: IID }));
    expect(screen.queryByRole('link', { name: 'Back to MRs' })).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Back to review' }));

    expect(app.router.state.location.pathname).toBe('/session/s1/plan');
  });

  it('F-20.1 opened from S-01, the link reads "Back to MRs" and goes back to S-01', async () => {
    const user = userEvent.setup();
    const { router } = await openPipeline();

    await status();
    expect(screen.queryByRole('link', { name: 'Back to review' })).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Back to MRs' }));

    expect(router.state.location.pathname).toBe('/');
  });

  it('F-20.1 a start with no screen before it reads "Back to review"', async () => {
    const rec = await backend();
    renderApp({ screen: 'S-08', iid: IID }, rec.client);

    expect(await screen.findByRole('link', { name: 'Back to review' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to MRs' })).toBeNull();
  });
});
