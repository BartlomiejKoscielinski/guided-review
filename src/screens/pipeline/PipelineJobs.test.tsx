import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-20.2: a refused row action names the action that failed (M6 plan decision 8):
// "Couldn't retry the job. <reason>" / "Couldn't cancel the job. <reason>".

const IID = 482;
type Row = Awaited<ReturnType<IpcClient['pipelineJobs']>>[number]['jobs'][number];

const refused = () =>
  Promise.reject(
    new IpcError({ code: 'GITLAB_FORBIDDEN', message: '403 Forbidden', retryable: false }),
  );

async function openWith(rows: Row[], override: Partial<IpcClient>) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const rec = recordingClient({
    ...base,
    pipelineJobs: () => Promise.resolve([{ name: 'test', jobs: rows }]),
    jobTrace: () => new Promise<void>(() => undefined),
    ...override,
  });
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: IID })));
  return userEvent.setup();
}

describe('S-08 refused row actions (F-20.2)', () => {
  it('F-20.2 a refused Retry says the retry failed, then GitLab’s reason', async () => {
    const user = await openWith(
      [
        {
          id: 5,
          name: 'unit-tests',
          state: 'failed',
          action: 'retry',
          durationSecs: null,
          webUrl: null,
        },
      ],
      { jobRetry: refused },
    );

    await user.click(await screen.findByRole('button', { name: 'Retry unit-tests' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Couldn't retry the job\. 403 Forbidden$/,
    );
  });

  it('F-20.2 a refused Cancel says the cancel failed, then GitLab’s reason', async () => {
    const user = await openWith(
      [
        {
          id: 6,
          name: 'sonar',
          state: 'running',
          action: 'cancel',
          durationSecs: null,
          webUrl: null,
        },
      ],
      { jobCancel: refused },
    );

    await user.click(await screen.findByRole('button', { name: 'Cancel sonar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Couldn't cancel the job\. 403 Forbidden$/,
    );
  });
});
