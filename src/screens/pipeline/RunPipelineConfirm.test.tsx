import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-20.3: "Run new pipeline" on S-08 asks first (Pipeline.dc.html's confirmation strip) and then
// shows the new pipeline live (M6 decisions 7, 8 and 9). Against the mock backend's !482 (the
// mock has the new pipeline #18351 once it is run) and against replaced
// `pipelineMrHead(project, iid)` / `pipelineRunMr(project, iid)` answers for the rest.
//
// Locators the screen keeps:
//  - the header button "Run new pipeline" (exact name; one on the page, also with no pipeline).
//  - the strip: role="alertdialog" named "Run new pipeline", holding "Run a new merge request
//    pipeline on <sha>?" (the 7-char SHA of the MR's head, `pipelineMrHead`, in its own element,
//    not the newest pipeline's SHA) and "Uses the MR's latest commit. Manual jobs stay manual.",
//    and the buttons "Run pipeline" and "Cancel". The strip is below the actions row.
//  - the failure: role="alert" "Couldn't run a pipeline. <reason>" under the actions row, where
//    <reason> is the IpcError's message.
//
// Decisions the tests lock (none is in the spec or the mock):
//  - `pipelineMrHead` is read when the strip opens, never when the page loads; "Run pipeline" is
//    disabled until it answers, and a failed read shows the failure line and keeps it disabled.
//  - Run pipeline sends `pipelineRunMr` once and closes the strip at once; the header button is
//    disabled with aria-busy="true" until GitLab answers; a failure leaves no strip, the button
//    works again, and opening the strip again clears the failure line.
//  - Opening the strip focuses Cancel (a write to GitLab: the safe button first); Escape and
//    Cancel close it and give the focus back to "Run new pipeline".
//  - The new pipeline's tab is selected, even when the user was on another tab.

const PROJECT = 'mobile/mobile-app';
const IID = 482;
const HEAD = 'b7e41d0'.padEnd(40, '0');
const RUN = 'Run new pipeline';
const COPY =
  /^Run a new merge request pipeline on b7e41d0\?\s*Uses the MR['’]s latest commit\. Manual jobs stay manual\.\s*Run pipeline\s*Cancel$/;

type Tab = Awaited<ReturnType<IpcClient['pipelineList']>>[number];

afterEach(() => {
  vi.useRealTimers();
});

async function openPipeline(override: (base: IpcClient) => Partial<IpcClient> = () => ({})) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const rec = recordingClient({ ...base, ...override(base) });
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: IID })));
  return { ...app, ...rec };
}

const runButton = () => screen.getByRole('button', { name: RUN });
const strip = () => screen.findByRole('alertdialog', { name: RUN });
const gitlabError = (message: string) =>
  new IpcError({ code: 'INVALID_INPUT', message, retryable: false });
const newTab = (over: Partial<Tab> = {}): Tab => ({
  id: 18351,
  number: 18351,
  sha: HEAD,
  version: 3,
  latest: true,
  status: 'running',
  ...over,
});

/** A promise settled by the test. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Opens the strip and waits until "Run pipeline" can be clicked; returns the strip. */
async function openStrip(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByTestId('pipeline-status');
  await user.click(runButton());
  const dialog = await strip();
  await waitFor(() => {
    expect(within(dialog).getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
  });
  return dialog;
}

describe('the confirmation strip of Run new pipeline (F-20.3)', () => {
  it('F-20.3 the page loads without a strip and without reading the MR head or starting anything', async () => {
    const pipelineMrHead = vi.fn<IpcClient['pipelineMrHead']>(() => Promise.resolve(HEAD));
    const pipelineRunMr = vi.fn<IpcClient['pipelineRunMr']>();
    await openPipeline(() => ({ pipelineMrHead, pipelineRunMr }));

    expect(await screen.findByTestId('pipeline-status')).toBeInTheDocument();

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(pipelineMrHead).not.toHaveBeenCalled();
    expect(pipelineRunMr).not.toHaveBeenCalled();
  });

  it('F-20.3 Run new pipeline asks first: the strip names the 7 characters of the MR head and the two promises, and starts nothing', async () => {
    const user = userEvent.setup();
    const pipelineMrHead = vi.fn<IpcClient['pipelineMrHead']>(() => Promise.resolve(HEAD));
    const pipelineRunMr = vi.fn<IpcClient['pipelineRunMr']>();
    await openPipeline(() => ({ pipelineMrHead, pipelineRunMr }));

    const dialog = await openStrip(user);

    expect(dialog).toHaveTextContent(COPY);
    expect(within(dialog).getByText('b7e41d0')).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(HEAD);
    // The newest pipeline of the page is on a3f9c12; the strip names the MR's head, not that.
    expect(dialog).not.toHaveTextContent('a3f9c12');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(pipelineMrHead).toHaveBeenCalledWith(PROJECT, IID);
    expect(pipelineRunMr).not.toHaveBeenCalled();
  });

  it('F-20.3 Cancel closes the strip, sends nothing and gives the focus back to Run new pipeline', async () => {
    const user = userEvent.setup();
    const pipelineRunMr = vi.fn<IpcClient['pipelineRunMr']>();
    const { calls } = await openPipeline(() => ({
      pipelineMrHead: () => Promise.resolve(HEAD),
      pipelineRunMr,
    }));
    const dialog = await openStrip(user);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(runButton()).toHaveFocus();
    expect(pipelineRunMr).not.toHaveBeenCalled();
    expect(calls).not.toContain('pipelineRunMr');
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('F-20.3 Escape closes the strip like Cancel: nothing is sent and the focus goes back to Run new pipeline', async () => {
    const user = userEvent.setup();
    const pipelineRunMr = vi.fn<IpcClient['pipelineRunMr']>();
    await openPipeline(() => ({ pipelineMrHead: () => Promise.resolve(HEAD), pipelineRunMr }));
    const dialog = await openStrip(user);
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(runButton()).toHaveFocus();
    expect(pipelineRunMr).not.toHaveBeenCalled();
  });

  it('F-20.3 the strip opens with the focus on Cancel, so a stray Enter sends nothing', async () => {
    const user = userEvent.setup();
    const pipelineRunMr = vi.fn<IpcClient['pipelineRunMr']>();
    await openPipeline(() => ({ pipelineMrHead: () => Promise.resolve(HEAD), pipelineRunMr }));
    const dialog = await openStrip(user);

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
    await user.keyboard('{Enter}');

    expect(pipelineRunMr).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('F-20.3 until the MR head is known the strip cannot be confirmed; then Run pipeline is enabled', async () => {
    const user = userEvent.setup();
    const head = deferred<string>();
    await openPipeline(() => ({ pipelineMrHead: () => head.promise }));
    await screen.findByTestId('pipeline-status');

    await user.click(runButton());

    const dialog = await strip();
    expect(within(dialog).getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await act(async () => {
      head.resolve(HEAD);
      await head.promise;
    });
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
    });
    expect(dialog).toHaveTextContent('b7e41d0');
  });

  it('F-20.3 a failed read of the MR head shows "Couldn\'t run a pipeline. <reason>" and Run pipeline stays disabled', async () => {
    const user = userEvent.setup();
    const pipelineRunMr = vi.fn<IpcClient['pipelineRunMr']>();
    await openPipeline(() => ({
      pipelineMrHead: () => Promise.reject(gitlabError('GitLab didn’t find it.')),
      pipelineRunMr,
    }));
    await screen.findByTestId('pipeline-status');

    await user.click(runButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't run a pipeline. GitLab didn’t find it.",
    );
    const dialog = screen.queryByRole('alertdialog');
    if (dialog) {
      expect(within(dialog).getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
    }
    expect(pipelineRunMr).not.toHaveBeenCalled();
  });
});

describe('running the new pipeline (F-20.3)', () => {
  it('F-20.3 Run pipeline sends one run for the MR, closes the strip and selects the new pipeline #18351, running and started by you just now', async () => {
    const user = userEvent.setup();
    let runs = vi.fn<IpcClient['pipelineRunMr']>();
    await openPipeline((base) => {
      runs = vi.fn<IpcClient['pipelineRunMr']>((...a) => base.pipelineRunMr(...a));
      return { pipelineRunMr: runs };
    });
    const dialog = await openStrip(user);

    await user.click(within(dialog).getByRole('button', { name: 'Run pipeline' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /#18351/ })).toHaveAttribute('aria-selected', 'true');
    });
    expect(runs).toHaveBeenCalledTimes(1);
    expect(runs).toHaveBeenCalledWith(PROJECT, IID);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(tabs[0]).toHaveTextContent(/^#18351\s*version 3 · latest/);
    expect(tabs[1]).toHaveTextContent(/^#18342\s*version 3$/);
    expect(tabs[1]).not.toHaveTextContent('latest');
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent(/^Running$/);
    });
    const line = within(screen.getByTestId('pipeline-meta'));
    expect(line.getByText('#18351')).toBeInTheDocument();
    expect(line.getByText('a3f9c12')).toBeInTheDocument();
    expect(line.getByText('version 3 · started by you · just now')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('F-20.3 the new pipeline is selected even when the user was looking at an older one', async () => {
    const user = userEvent.setup();
    await openPipeline();
    await screen.findByTestId('pipeline-status');
    await user.click(screen.getByRole('tab', { name: /#18321/ }));
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent(/^Failed$/);
    });

    const dialog = await openStrip(user);
    await user.click(within(dialog).getByRole('button', { name: 'Run pipeline' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /#18351/ })).toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getByRole('tab', { name: /#18321/ })).toHaveAttribute('aria-selected', 'false');
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent(/^Running$/);
    });
  });

  it('F-20.3 the new pipeline shows its stage columns with the running build stage and the manual jobs still manual', async () => {
    const user = userEvent.setup();
    await openPipeline();
    const dialog = await openStrip(user);

    await user.click(within(dialog).getByRole('button', { name: 'Run pipeline' }));

    expect(
      await screen.findByRole('button', { name: 'build:android, Running' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'sonar, Waiting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'distribute:qa, Manual' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ui-tests:ios-device, Manual' })).toBeInTheDocument();
  });

  it('F-20.3 the new pipeline is shown live: its head and jobs are read again every 5 seconds while a job runs', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    let jobs = vi.fn<IpcClient['pipelineJobs']>();
    let heads = vi.fn<IpcClient['pipelineGet']>();
    await openPipeline((base) => {
      jobs = vi.fn<IpcClient['pipelineJobs']>((...a) => base.pipelineJobs(...a));
      heads = vi.fn<IpcClient['pipelineGet']>((...a) => base.pipelineGet(...a));
      return { pipelineJobs: jobs, pipelineGet: heads };
    });
    const dialog = await openStrip(user);
    await user.click(within(dialog).getByRole('button', { name: 'Run pipeline' }));
    await screen.findByRole('button', { name: 'build:android, Running' });
    const jobsBefore = jobs.mock.calls.filter((c) => c[2] === 18351).length;
    const headsBefore = heads.mock.calls.filter((c) => c[2] === 18351).length;

    await act(() => vi.advanceTimersByTimeAsync(5_500));

    expect(jobs.mock.calls.filter((c) => c[2] === 18351).length).toBeGreaterThan(jobsBefore);
    expect(heads.mock.calls.filter((c) => c[2] === 18351).length).toBeGreaterThan(headsBefore);
  });

  it('F-20.3 while GitLab starts the pipeline the header button is busy and cannot send a second run', async () => {
    const user = userEvent.setup();
    const pending = deferred<Tab>();
    const pipelineRunMr = vi.fn<IpcClient['pipelineRunMr']>(() => pending.promise);
    await openPipeline(() => ({ pipelineMrHead: () => Promise.resolve(HEAD), pipelineRunMr }));
    const dialog = await openStrip(user);

    await user.click(within(dialog).getByRole('button', { name: 'Run pipeline' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(runButton()).toBeDisabled();
    expect(runButton()).toHaveAttribute('aria-busy', 'true');
    await user.click(runButton());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(pipelineRunMr).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(newTab());
      await pending.promise;
    });
    await waitFor(() => {
      expect(runButton()).toBeEnabled();
    });
    expect(runButton()).not.toHaveAttribute('aria-busy', 'true');
  });

  it('F-20.3 a refusal shows "Couldn\'t run a pipeline. <GitLab\'s reason>" under the actions, adds no tab and leaves the button usable', async () => {
    const user = userEvent.setup();
    await openPipeline(() => ({
      pipelineMrHead: () => Promise.resolve(HEAD),
      pipelineRunMr: () => Promise.reject(gitlabError('No stages / jobs for this pipeline.')),
    }));
    const dialog = await openStrip(user);

    await user.click(within(dialog).getByRole('button', { name: 'Run pipeline' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't run a pipeline. No stages / jobs for this pipeline.",
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /#18342/ })).toHaveAttribute('aria-selected', 'true');
    expect(runButton()).toBeEnabled();
    expect(runButton()).not.toHaveAttribute('aria-busy', 'true');
  });

  it('F-20.3 opening the strip again clears the failure line, and a second try can succeed', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    await openPipeline((base) => ({
      pipelineRunMr: (...a) => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(gitlabError('No stages / jobs for this pipeline.'))
          : base.pipelineRunMr(...a);
      },
    }));
    let dialog = await openStrip(user);
    await user.click(within(dialog).getByRole('button', { name: 'Run pipeline' }));
    await screen.findByRole('alert');

    await user.click(runButton());

    dialog = await strip();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
    });
    await user.click(within(dialog).getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /#18351/ })).toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('F-20.3 an MR with no pipeline can start its first one: Run new pipeline, the strip, then the new pipeline replaces "No pipeline for this MR yet."', async () => {
    const user = userEvent.setup();
    let started = false;
    const tab = newTab();
    await openPipeline((base) => ({
      pipelineList: () => Promise.resolve(started ? [tab] : []),
      pipelineMrHead: () => Promise.resolve(HEAD),
      pipelineRunMr: () => {
        started = true;
        return Promise.resolve(tab);
      },
      pipelineGet: (project, iid, id) =>
        id === 18351
          ? Promise.resolve({
              status: 'running',
              allowedFailures: 0,
              number: 18351,
              kind: 'Merge request pipeline',
              sha: HEAD,
              version: 3,
              author: 'Bartek K.',
              startedByMe: true,
              startedAt: new Date().toISOString(),
              durationSecs: null,
            })
          : base.pipelineGet(project, iid, id),
      pipelineJobs: () => Promise.resolve([]),
    }));
    expect(await screen.findByText('No pipeline for this MR yet.')).toBeInTheDocument();

    await user.click(runButton());
    const dialog = await strip();
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
    });
    expect(dialog).toHaveTextContent('b7e41d0');
    await user.click(within(dialog).getByRole('button', { name: 'Run pipeline' }));

    expect(await screen.findByRole('tab', { name: /#18351/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByText('No pipeline for this MR yet.')).toBeNull();
    expect(await screen.findByTestId('pipeline-status')).toHaveTextContent(/^Running$/);
  });
});
