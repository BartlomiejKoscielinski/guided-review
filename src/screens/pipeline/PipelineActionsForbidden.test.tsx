import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-20.4, insufficient permission (M6 decision 9, docs/02 S-08 States): after any pipeline or job
// write returns GitLab's 403 (an IpcError with code GITLAB_FORBIDDEN), every write action of S-08
// is disabled until the screen reopens: the row Retry / Cancel buttons, Retry failed jobs,
// Cancel pipeline and Run new pipeline. The tooltip (the `title`) and the accessible description
// of each is GitLab's 403 message: the error's `detail` (GitLab's own words) when it has one,
// else its `message`. Open in GitLab is not a write: it stays enabled. The failure line of the
// action that was refused stays (its sentence is locked in PipelineActions.test.tsx and
// PipelineJobs.test.tsx). Nothing is pre-checked: a refused read, or a failure with another code,
// disables nothing. "Run <job>" of F-20.6 is not built yet.
//
// Existing tests this reverses (the implementer edits them, the neighbouring assertions stay):
// StageColumns.test.tsx 'F-20.2 a refused Retry shows GitLab’s message as an alert and leaves the
// row failed with Retry ready again' and 'F-20.2 a refused Cancel shows GitLab’s message as an
// alert and leaves the row running' now expect the row button toBeDisabled() (the alert, the
// row state and the "Retry unit-tests" / "Cancel sonar" accessible names are unchanged).

const FRIENDLY = 'GitLab doesn’t allow this for your account.';
const REASON = '403 Forbidden - You can’t retry pipelines on this branch.';

const forbidden = (message = FRIENDLY, detail: string | undefined = REASON) =>
  new IpcError({ code: 'GITLAB_FORBIDDEN', message, detail, retryable: false });

type Head = Awaited<ReturnType<IpcClient['pipelineGet']>>;

async function openMock(override: (base: IpcClient) => Partial<IpcClient> = () => ({})) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const rec = recordingClient({ ...base, ...override(base) });
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: 482 })));
  return { ...app, ...rec, user: userEvent.setup() };
}

/** S-08 of !482 with #18321 (Failed) selected. */
async function openFailed(override: (base: IpcClient) => Partial<IpcClient> = () => ({})) {
  const opened = await openMock(override);
  const { user } = opened;
  await user.click(await screen.findByRole('tab', { name: /#18321/ }));
  await waitFor(() => {
    expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Failed');
  });
  await screen.findByRole('button', { name: 'Retry unit-tests', exact: true });
  return opened;
}

const need = (name: string) => screen.getByRole('button', { name, exact: true });

/** Disabled, with `reason` as tooltip and as accessible description. */
function expectRefused(button: HTMLElement, reason: string) {
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('title', reason);
  expect(button).toHaveAccessibleDescription(reason);
}

const runningHead: Head = {
  status: 'running',
  allowedFailures: 0,
  number: 18342,
  kind: 'Merge request pipeline',
  sha: 'a3f9c12'.padEnd(40, '0'),
  version: 3,
  author: 'Marta K.',
  startedByMe: false,
  startedAt: new Date(Date.now() - 600_000).toISOString(),
  durationSecs: null,
  webUrl: 'https://gitlab.local/mobile/mobile-app/-/pipelines/18342',
};

describe('after a refused write every write action is disabled (F-20.4)', () => {
  it('F-20.4 a refused Retry failed jobs disables Retry failed jobs, Run new pipeline and the row Retry with GitLab’s reason as tooltip and description, and keeps Open in GitLab', async () => {
    const pipelineRetry = vi.fn<IpcClient['pipelineRetry']>(() => Promise.reject(forbidden()));
    const { user } = await openFailed(() => ({ pipelineRetry }));

    await user.click(need('Retry failed jobs'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Couldn't retry the failed jobs. ${FRIENDLY}`,
    );
    await waitFor(() => {
      expectRefused(need('Retry failed jobs'), REASON);
    });
    expectRefused(need('Run new pipeline'), REASON);
    expectRefused(need('Retry unit-tests'), REASON);
    expect(need('Open in GitLab')).toBeEnabled();
    expect(need('Open in GitLab')).not.toHaveAttribute('title', REASON);
    // The pipeline is as it was.
    expect(screen.getByTestId('pipeline-status')).toHaveTextContent('Failed');
  });

  it('F-20.4 a 403 without GitLab’s own words uses the error’s message as the tooltip', async () => {
    const { user } = await openFailed(() => ({
      pipelineRetry: () =>
        Promise.reject(
          new IpcError({ code: 'GITLAB_FORBIDDEN', message: '403 Forbidden', retryable: false }),
        ),
    }));

    await user.click(need('Retry failed jobs'));

    await waitFor(() => {
      expectRefused(need('Retry failed jobs'), '403 Forbidden');
    });
    expectRefused(need('Run new pipeline'), '403 Forbidden');
  });

  it('F-20.4 a disabled action sends nothing when clicked', async () => {
    const pipelineRetry = vi.fn<IpcClient['pipelineRetry']>(() => Promise.reject(forbidden()));
    const { user, calls } = await openFailed(() => ({ pipelineRetry }));
    await user.click(need('Retry failed jobs'));
    await waitFor(() => {
      expect(need('Retry failed jobs')).toBeDisabled();
    });

    await user.click(need('Retry failed jobs'));
    await user.click(need('Run new pipeline'));
    await user.click(need('Retry unit-tests'));

    expect(pipelineRetry).toHaveBeenCalledTimes(1);
    expect(calls).not.toContain('jobRetry');
    expect(calls).not.toContain('pipelineMrHead');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('F-20.4 a refused row Retry disables the pipeline actions and Run new pipeline too', async () => {
    const { user } = await openFailed(() => ({ jobRetry: () => Promise.reject(forbidden()) }));

    await user.click(need('Retry unit-tests'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Couldn't retry the job. ${FRIENDLY}`,
    );
    await waitFor(() => {
      expectRefused(need('Retry unit-tests'), REASON);
    });
    expectRefused(need('Retry failed jobs'), REASON);
    expectRefused(need('Run new pipeline'), REASON);
    expect(need('Open in GitLab')).toBeEnabled();
  });

  it('F-20.4 a refused Cancel pipeline disables Cancel pipeline, the row Cancel and Run new pipeline', async () => {
    const { user } = await openMock(() => ({
      pipelineGet: () => Promise.resolve(runningHead),
      pipelineJobs: () =>
        Promise.resolve([
          {
            name: 'test',
            jobs: [
              { id: 6, name: 'sonar', state: 'running', action: 'cancel', durationSecs: null },
            ],
          },
        ]),
      pipelineCancel: () => Promise.reject(forbidden()),
    }));

    await user.click(await screen.findByRole('button', { name: 'Cancel pipeline', exact: true }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Couldn't cancel the pipeline. ${FRIENDLY}`,
    );
    await waitFor(() => {
      expectRefused(need('Cancel pipeline'), REASON);
    });
    expectRefused(need('Cancel sonar'), REASON);
    expectRefused(need('Run new pipeline'), REASON);
    expect(need('Open in GitLab')).toBeEnabled();
  });

  it('F-20.4 a refused Run new pipeline disables Run new pipeline and Retry failed jobs', async () => {
    const { user } = await openFailed(() => ({
      pipelineRunMr: () => Promise.reject(forbidden()),
    }));
    await user.click(need('Run new pipeline'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Run new pipeline' });
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
    });

    await user.click(within(dialog).getByRole('button', { name: 'Run pipeline' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Couldn't run a pipeline. ${FRIENDLY}`,
    );
    await waitFor(() => {
      expectRefused(need('Run new pipeline'), REASON);
    });
    expectRefused(need('Retry failed jobs'), REASON);
    expectRefused(need('Retry unit-tests'), REASON);
  });

  it('F-20.4 reopening the screen enables the actions again', async () => {
    const pipelineRetry = vi.fn<IpcClient['pipelineRetry']>(() => Promise.reject(forbidden()));
    const { user, router } = await openFailed(() => ({ pipelineRetry }));
    await user.click(need('Retry failed jobs'));
    await waitFor(() => {
      expect(need('Run new pipeline')).toBeDisabled();
    });

    await act(() => router.navigate(pathFor({ screen: 'S-01' })));
    await act(() => router.navigate(pathFor({ screen: 'S-08', iid: 482 })));

    expect(
      await screen.findByRole('button', { name: 'Run new pipeline', exact: true }),
    ).toBeEnabled();
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toBeInTheDocument();
    });
    expect(need('Run new pipeline')).not.toHaveAttribute('title', REASON);
    expect(
      await screen.findByRole('button', { name: 'Retry failed jobs', exact: true }),
    ).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('F-20.4 nothing is pre-checked: a refused read (not a write) leaves Run new pipeline enabled', async () => {
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    const app = renderApp(
      { screen: 'S-01' },
      { ...base, pipelineGet: () => Promise.reject(forbidden()) },
    );
    await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: 482 })));

    await screen.findByRole('alert');

    expect(need('Run new pipeline')).toBeEnabled();
    expect(need('Run new pipeline')).not.toHaveAttribute('title', REASON);
  });

  it('F-20.4 a failed write that is not a 403 disables nothing', async () => {
    const { user } = await openFailed(() => ({
      pipelineRetry: () =>
        Promise.reject(
          new IpcError({
            code: 'GITLAB_UNREACHABLE',
            message: 'GitLab can’t be reached.',
            retryable: true,
          }),
        ),
    }));

    await user.click(need('Retry failed jobs'));
    await screen.findByRole('alert');

    expect(need('Retry failed jobs')).toBeEnabled();
    expect(need('Run new pipeline')).toBeEnabled();
    expect(need('Retry unit-tests')).toBeEnabled();
  });
});
