import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-20.4: the pipeline actions of S-08's head (Pipeline.dc.html, M6 decisions 6 and 13):
// "Retry failed jobs", "Cancel pipeline", "Open in GitLab" and the existing "Run new pipeline",
// in that order, all <button>s. Against the mock backend's !482 (#18342 Passed with 1 allowed
// failure, #18321 Failed, #18320 Canceled; the mock's `pipelineRetry` / `pipelineCancel` change
// its pipelines) and against replaced answers for the rest. The 403 state is in
// PipelineActionsForbidden.test.tsx.
//
// Locators the screen keeps: the four buttons by accessible name (exact), the status word in
// data-testid="pipeline-status", the job select buttons "<job>, <Label>" of F-20.2, a failure as
// the one role="alert".
//
// Decisions the tests lock (none is in the spec or the mock):
//  - Retry failed jobs shows when the pipeline is not running and one of its jobs is failed,
//    failed-allowed or canceled (GitLab retries an allowed failure too; the mock counts it).
//    Cancel pipeline shows while the head says Running. Neither shows while the head or the jobs
//    load or on a restored start; Open in GitLab then shows, disabled.
//  - Both act at once, without a dialog (decision 6); the button is disabled with
//    aria-busy="true" until GitLab answers, so a second click sends nothing.
//  - A failure shows "Couldn't retry the failed jobs. <reason>" / "Couldn't cancel the pipeline.
//    <reason>" / "Couldn't open GitLab. <reason>" (<reason> = the IpcError's message) and leaves
//    the button ready; a new attempt clears the line.
//  - Open in GitLab sends `osOpenGitlabUrl(head.webUrl)` once; it is disabled without a web URL.

const PROJECT = 'mobile/mobile-app';
const IID = 482;
const URL_18342 = 'https://gitlab.local/mobile/mobile-app/-/pipelines/18342';

type Head = Awaited<ReturnType<IpcClient['pipelineGet']>>;
type Column = Awaited<ReturnType<IpcClient['pipelineJobs']>>[number];
type Row = Column['jobs'][number];

const row = (over: Partial<Row> & Pick<Row, 'name'>): Row => ({
  id: 1,
  state: 'passed',
  action: null,
  durationSecs: null,
  webUrl: null,
  ...over,
});
const head = (over: Partial<Head> = {}): Head => ({
  status: 'passed',
  allowedFailures: 0,
  number: 18342,
  kind: 'Merge request pipeline',
  sha: 'a3f9c12'.padEnd(40, '0'),
  version: 3,
  author: 'Marta K.',
  startedByMe: false,
  startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  durationSecs: 840,
  webUrl: URL_18342,
  ...over,
});
const answers = (h: Head, ...rows: Row[]): Partial<IpcClient> => ({
  jobTrace: () => new Promise<void>(() => undefined),
  pipelineGet: () => Promise.resolve(h),
  pipelineJobs: () => Promise.resolve([{ name: 'test', jobs: rows }]),
});
const unreachable = () =>
  new IpcError({
    code: 'GITLAB_UNREACHABLE',
    message: 'GitLab can’t be reached.',
    retryable: true,
  });

async function openPipeline(
  override: (base: IpcClient) => Partial<IpcClient> = () => ({}),
  start: 'navigated' | 'restored' = 'navigated',
) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const rec = recordingClient({ ...base, ...override(base) });
  if (start === 'restored') {
    const app = renderApp({ screen: 'S-08', iid: IID }, rec.client);
    return { ...app, ...rec, user: userEvent.setup() };
  }
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: IID })));
  return { ...app, ...rec, user: userEvent.setup() };
}

const action = (name: string) => screen.queryByRole('button', { name, exact: true });
const need = (name: string) => screen.getByRole('button', { name, exact: true });
const status = () => screen.findByTestId('pipeline-status');
const select = (name: string, label: string) =>
  screen.getByRole('button', { name: `${name}, ${label}`, exact: true });

/** Selects #18321 (Failed) and waits until its head is shown. */
async function openFailed(override?: (base: IpcClient) => Partial<IpcClient>) {
  const opened = await openPipeline(override);
  await opened.user.click(await screen.findByRole('tab', { name: /#18321/ }));
  await waitFor(() => {
    expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Failed');
  });
  await screen.findByRole('button', { name: 'Retry unit-tests', exact: true });
  return opened;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('which actions S-08 offers (F-20.4)', () => {
  it('F-20.4 a failed pipeline offers Retry failed jobs, Open in GitLab and Run new pipeline in that order, and no Cancel pipeline', async () => {
    await openFailed();

    const retry = need('Retry failed jobs');
    const open = need('Open in GitLab');
    const run = need('Run new pipeline');
    expect(retry).toBeEnabled();
    expect(open).toBeEnabled();
    expect(run).toBeEnabled();
    expect(retry.compareDocumentPosition(open)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(open.compareDocumentPosition(run)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(action('Cancel pipeline')).toBeNull();
  });

  it('F-20.4 a passed pipeline with an allowed failure still offers Retry failed jobs (GitLab retries the allowed failure too)', async () => {
    await openPipeline();
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Passed');
    });

    expect(
      await screen.findByRole('button', { name: 'Retry failed jobs', exact: true }),
    ).toBeEnabled();
    expect(action('Cancel pipeline')).toBeNull();
    expect(need('Open in GitLab')).toBeEnabled();
  });

  it('F-20.4 a canceled pipeline offers Retry failed jobs for its canceled jobs', async () => {
    const { user } = await openPipeline();
    await user.click(await screen.findByRole('tab', { name: /#18320/ }));
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Canceled');
    });

    expect(
      await screen.findByRole('button', { name: 'Retry failed jobs', exact: true }),
    ).toBeEnabled();
    expect(action('Cancel pipeline')).toBeNull();
  });

  it('F-20.4 a pipeline whose jobs all passed, were skipped or wait for a click has no Retry failed jobs and no Cancel pipeline, only Open in GitLab', async () => {
    await openPipeline(() =>
      answers(
        head(),
        row({ id: 1, name: 'build', state: 'passed' }),
        row({ id: 2, name: 'sonar', state: 'skipped' }),
        row({ id: 3, name: 'distribute:qa', state: 'manual', action: 'run' }),
      ),
    );
    await status();

    expect(
      await screen.findByRole('button', { name: 'Open in GitLab', exact: true }),
    ).toBeEnabled();
    expect(action('Retry failed jobs')).toBeNull();
    expect(action('Cancel pipeline')).toBeNull();
    expect(need('Run new pipeline')).toBeEnabled();
  });

  it('F-20.4 a running pipeline offers Cancel pipeline, and no Retry failed jobs even while one of its jobs has failed', async () => {
    await openPipeline(() =>
      answers(
        head({ status: 'running', durationSecs: null }),
        row({ id: 1, name: 'unit-tests', state: 'failed', action: 'retry' }),
        row({ id: 2, name: 'sonar', state: 'running', action: 'cancel' }),
      ),
    );
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Running');
    });

    expect(
      await screen.findByRole('button', { name: 'Cancel pipeline', exact: true }),
    ).toBeEnabled();
    expect(action('Retry failed jobs')).toBeNull();
    expect(need('Open in GitLab')).toBeEnabled();
  });

  it('F-20.4 while the head loads neither Retry failed jobs nor Cancel pipeline is offered and Open in GitLab is disabled', async () => {
    await openPipeline(() => ({ pipelineGet: () => new Promise(() => undefined) }));
    await screen.findByRole('tab', { name: /#18342/ });

    expect(
      await screen.findByRole('button', { name: 'Open in GitLab', exact: true }),
    ).toBeDisabled();
    expect(action('Retry failed jobs')).toBeNull();
    expect(action('Cancel pipeline')).toBeNull();
  });

  it('F-20.4 a pipeline GitLab gave no web URL cannot be opened: Open in GitLab is disabled', async () => {
    await openPipeline(() => answers(head({ webUrl: null }), row({ name: 'build' })));
    await status();

    expect(need('Open in GitLab')).toBeDisabled();
  });

  it('F-20.4 a restored start offers no pipeline action but a disabled Open in GitLab', async () => {
    await openPipeline(() => ({}), 'restored');

    expect(await screen.findByText('Open the pipeline again to load it.')).toBeInTheDocument();
    expect(need('Open in GitLab')).toBeDisabled();
    expect(action('Retry failed jobs')).toBeNull();
    expect(action('Cancel pipeline')).toBeNull();
  });
});

describe('Retry failed jobs and Cancel pipeline act at once (F-20.4)', () => {
  it('F-20.4 Retry failed jobs sends one pipelineRetry for the selected pipeline without a dialog, and the pipeline then reads Running with Cancel pipeline instead', async () => {
    const pipelineRetry = vi.fn<IpcClient['pipelineRetry']>();
    const { user } = await openFailed((base) => ({
      pipelineRetry: pipelineRetry.mockImplementation((...a) => base.pipelineRetry(...a)),
    }));

    await user.click(need('Retry failed jobs'));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(pipelineRetry).toHaveBeenCalledTimes(1);
    expect(pipelineRetry).toHaveBeenCalledWith(PROJECT, IID, 18321);
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Running');
    });
    expect(
      await screen.findByRole('button', { name: 'Cancel pipeline', exact: true }),
    ).toBeEnabled();
    expect(action('Retry failed jobs')).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'unit-tests, Running', exact: true }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('F-20.4 Retry failed jobs on the shown pipeline #18342 retries #18342, not the newest', async () => {
    const pipelineRetry = vi.fn<IpcClient['pipelineRetry']>();
    const { user } = await openPipeline((base) => ({
      pipelineRetry: pipelineRetry.mockImplementation((...a) => base.pipelineRetry(...a)),
    }));
    await user.click(await screen.findByRole('button', { name: 'Retry failed jobs', exact: true }));

    expect(pipelineRetry).toHaveBeenCalledWith(PROJECT, IID, 18342);
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Running');
    });
  });

  it('F-20.4 while GitLab answers, Retry failed jobs is disabled and busy and a second click sends nothing', async () => {
    const gate = deferred<undefined>();
    const pipelineRetry = vi.fn<IpcClient['pipelineRetry']>();
    const { user } = await openFailed((base) => ({
      pipelineRetry: pipelineRetry.mockImplementation(async (...a) => {
        await gate.promise;
        return base.pipelineRetry(...a);
      }),
    }));

    await user.click(need('Retry failed jobs'));
    await user.click(need('Retry failed jobs'));

    expect(pipelineRetry).toHaveBeenCalledTimes(1);
    expect(need('Retry failed jobs')).toBeDisabled();
    expect(need('Retry failed jobs')).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      gate.resolve(undefined);
      await gate.promise;
    });
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Running');
    });
  });

  it('F-20.4 Cancel pipeline sends one pipelineCancel without a dialog; the pipeline reads Canceled, its running job is canceled and Retry failed jobs is offered again', async () => {
    const pipelineCancel = vi.fn<IpcClient['pipelineCancel']>();
    const { user } = await openFailed((base) => ({
      pipelineCancel: pipelineCancel.mockImplementation((...a) => base.pipelineCancel(...a)),
    }));
    await user.click(need('Retry failed jobs'));
    await user.click(await screen.findByRole('button', { name: 'Cancel pipeline', exact: true }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(pipelineCancel).toHaveBeenCalledTimes(1);
    expect(pipelineCancel).toHaveBeenCalledWith(PROJECT, IID, 18321);
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Canceled');
    });
    expect(
      await screen.findByRole('button', { name: 'unit-tests, Canceled', exact: true }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Retry failed jobs', exact: true }),
    ).toBeEnabled();
    expect(action('Cancel pipeline')).toBeNull();
    expect(select('sonar', 'Skipped')).toBeInTheDocument();
  });

  it('F-20.4 while GitLab answers, Cancel pipeline is disabled and busy and a second click sends nothing', async () => {
    const gate = deferred<undefined>();
    const pipelineCancel = vi.fn<IpcClient['pipelineCancel']>();
    const { user } = await openFailed((base) => ({
      pipelineCancel: pipelineCancel.mockImplementation(async (...a) => {
        await gate.promise;
        return base.pipelineCancel(...a);
      }),
    }));
    await user.click(need('Retry failed jobs'));
    await user.click(await screen.findByRole('button', { name: 'Cancel pipeline', exact: true }));
    await user.click(need('Cancel pipeline'));

    expect(pipelineCancel).toHaveBeenCalledTimes(1);
    expect(need('Cancel pipeline')).toBeDisabled();
    expect(need('Cancel pipeline')).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      gate.resolve(undefined);
      await gate.promise;
    });
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Canceled');
    });
  });
});

describe('a refused or failed action (F-20.4)', () => {
  it('F-20.4 a failed Retry failed jobs says the retry failed, then the reason, and the button is ready again', async () => {
    const { user } = await openFailed(() => ({
      pipelineRetry: () => Promise.reject(unreachable()),
    }));

    await user.click(need('Retry failed jobs'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Couldn't retry the failed jobs\. GitLab can’t be reached\.$/,
    );
    expect(need('Retry failed jobs')).toBeEnabled();
    expect(need('Retry failed jobs')).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Failed');
    expect(select('unit-tests', 'Failed')).toBeInTheDocument();
  });

  it('F-20.4 a new attempt clears the failure line', async () => {
    let first = true;
    const { user } = await openFailed((base) => ({
      pipelineRetry: (...a) => {
        if (!first) return base.pipelineRetry(...a);
        first = false;
        return Promise.reject(unreachable());
      },
    }));
    await user.click(need('Retry failed jobs'));
    await screen.findByRole('alert');

    await user.click(need('Retry failed jobs'));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Running');
    });
  });

  it('F-20.4 a failed Cancel pipeline says the cancel failed, then the reason, and the pipeline stays Running with Cancel pipeline ready', async () => {
    const { user } = await openPipeline(() => ({
      ...answers(
        head({ status: 'running', durationSecs: null }),
        row({ id: 2, name: 'sonar', state: 'running', action: 'cancel' }),
      ),
      pipelineCancel: () => Promise.reject(unreachable()),
    }));

    await user.click(await screen.findByRole('button', { name: 'Cancel pipeline', exact: true }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Couldn't cancel the pipeline\. GitLab can’t be reached\.$/,
    );
    expect(need('Cancel pipeline')).toBeEnabled();
    expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Running');
    expect(select('sonar', 'Running')).toBeInTheDocument();
  });
});

describe('Open in GitLab (F-20.4)', () => {
  it('F-20.4 Open in GitLab hands the pipeline’s web URL to the core once and shows nothing else', async () => {
    const osOpenGitlabUrl = vi.fn<IpcClient['osOpenGitlabUrl']>(() => Promise.resolve());
    const { user } = await openPipeline(() => ({
      ...answers(head(), row({ name: 'build' })),
      osOpenGitlabUrl,
    }));
    await status();

    await user.click(need('Open in GitLab'));

    expect(osOpenGitlabUrl).toHaveBeenCalledTimes(1);
    expect(osOpenGitlabUrl).toHaveBeenCalledWith(URL_18342);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(need('Open in GitLab')).toBeEnabled();
  });

  it('F-20.4 Open in GitLab of another tab opens that pipeline’s page', async () => {
    const osOpenGitlabUrl = vi.fn<IpcClient['osOpenGitlabUrl']>(() => Promise.resolve());
    const { user } = await openPipeline(() => ({ osOpenGitlabUrl }));
    await user.click(await screen.findByRole('tab', { name: /#18321/ }));
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Failed');
    });

    await user.click(need('Open in GitLab'));

    expect(osOpenGitlabUrl).toHaveBeenCalledWith(
      'https://gitlab.local/mobile/mobile-app/-/pipelines/18321',
    );
  });

  it('F-20.4 a refused open says GitLab could not be opened, then the reason, and the button stays ready', async () => {
    const { user } = await openPipeline(() => ({
      ...answers(head(), row({ name: 'build' })),
      osOpenGitlabUrl: () =>
        Promise.reject(
          new IpcError({
            code: 'INVALID_INPUT',
            message: 'That link isn’t on your GitLab server.',
            retryable: false,
          }),
        ),
    }));
    await status();

    await user.click(need('Open in GitLab'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Couldn't open GitLab\. That link isn’t on your GitLab server\.$/,
    );
    expect(need('Open in GitLab')).toBeEnabled();
  });
});
