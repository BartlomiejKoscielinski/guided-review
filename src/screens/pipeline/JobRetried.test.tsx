import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-20.9: "Retried: failed again on the same test." in "Why it failed" of the job details panel
// of S-08 (Pipeline.dc.html, M6 decision 15). Client: `jobDetails(project, iid, job)` ->
// `{ retriedSameFailure: boolean }`.
//
// Locators the panel keeps: the region "Job details"; the line is one element with role "status"
// whose text is exactly "Retried: failed again on the same test." (an orange square beside it is
// decoration, aria-hidden).
//
// Decisions the tests lock (none is in the spec or the mock):
//  - Only a failed or failed-allowed job reads the details; the other states never show the line
//    and the client is not called for them.
//  - While the details load, and when the read fails, the line is simply absent: a wrong "same
//    test" claim would mislead more than silence, and an error here is no news to the user (no
//    alert, no extra status text).
//  - The line shows before Explain failure was clicked.
//  - Another selected job shows its own answer, not the last one.

const IID = 482;
const COPY = 'Retried: failed again on the same test.';
type Row = Awaited<ReturnType<IpcClient['pipelineJobs']>>[number]['jobs'][number];
type Details = Awaited<ReturnType<IpcClient['jobDetails']>>;

const row = (over: Partial<Row> & Pick<Row, 'id' | 'name'>): Row => ({
  state: 'failed',
  action: 'retry',
  durationSecs: 112,
  webUrl: `https://gitlab.local/mobile/mobile-app/-/jobs/${String(over.id)}`,
  ...over,
});

async function openWith(rows: Row[], override: Partial<IpcClient> = {}) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const asked: number[] = [];
  const rec = recordingClient({
    ...base,
    pipelineJobs: () => Promise.resolve([{ name: 'test', jobs: rows }]),
    jobTrace: () => new Promise<void>(() => undefined),
    jobDetails: (_project, _iid, job) => {
      asked.push(job);
      return Promise.resolve({ retriedSameFailure: true });
    },
    ...override,
  });
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: IID })));
  return { asked, user: userEvent.setup() };
}

const panel = async () => screen.findByRole('region', { name: 'Job details' });
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

describe('S-08 retried and failed again (F-20.9)', () => {
  it('F-20.9 a failed job that failed again on the same test says so as a status', async () => {
    const { asked } = await openWith([row({ id: 7, name: 'unit-tests' })]);

    const details = within(await panel());
    const line = await details.findByText(COPY);
    expect(line).toHaveAttribute('role', 'status');
    expect(asked).toEqual([7]);
  });

  it('F-20.9 a failed job allowed to fail says it too', async () => {
    await openWith([row({ id: 7, name: 'ui-tests:android', state: 'failedAllowed' })]);

    expect(await within(await panel()).findByText(COPY)).toBeInTheDocument();
  });

  it('F-20.9 a failed job that did not fail on the same test shows no line', async () => {
    const { asked } = await openWith([row({ id: 7, name: 'unit-tests' })], {
      jobDetails: () => Promise.resolve({ retriedSameFailure: false }),
    });

    const details = within(await panel());
    expect(await details.findByRole('button', { name: 'Explain failure' })).toBeInTheDocument();
    await settle();
    expect(details.queryByText(COPY)).not.toBeInTheDocument();
    // The details are still read for a failed job; only the answer decides.
    expect(asked).toEqual([7]);
  });

  it('F-20.9 the line shows next to Explain failure before Claude was asked', async () => {
    await openWith([row({ id: 7, name: 'unit-tests' })]);

    const details = within(await panel());
    expect(await details.findByText(COPY)).toBeInTheDocument();
    expect(details.getByRole('button', { name: 'Explain failure' })).toBeEnabled();
  });

  it.each([
    ['passed', null],
    ['running', 'cancel'],
    ['waiting', null],
    ['manual', 'run'],
    ['canceled', 'retry'],
    ['skipped', null],
  ] as const)(
    'F-20.9 a %s job never shows the line and reads no details',
    async (state, action) => {
      const { asked } = await openWith([row({ id: 7, name: 'unit-tests', state, action })]);

      const details = within(await panel());
      expect(await details.findByTestId('job-status')).toBeInTheDocument();
      await settle();
      expect(details.queryByText(COPY)).not.toBeInTheDocument();
      expect(asked).toEqual([]);
    },
  );

  it('F-20.9 while the details load there is no line', async () => {
    await openWith([row({ id: 7, name: 'unit-tests' })], {
      jobDetails: () => new Promise<Details>(() => undefined),
    });

    const details = within(await panel());
    expect(await details.findByRole('button', { name: 'Explain failure' })).toBeInTheDocument();
    await settle();
    expect(details.queryByText(COPY)).not.toBeInTheDocument();
  });

  it('F-20.9 a failed read shows no line and no alert', async () => {
    await openWith([row({ id: 7, name: 'unit-tests' })], {
      jobDetails: () =>
        Promise.reject(
          new IpcError({ code: 'GITLAB_NOT_FOUND', message: 'It is gone.', retryable: false }),
        ),
    });

    const details = within(await panel());
    expect(await details.findByRole('button', { name: 'Explain failure' })).toBeInTheDocument();
    await settle();
    expect(details.queryByText(COPY)).not.toBeInTheDocument();
    expect(details.queryByText(/It is gone\./)).not.toBeInTheDocument();
    expect(details.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('F-20.9 selecting another failed job shows the answer of that job', async () => {
    const { asked, user } = await openWith(
      [row({ id: 7, name: 'unit-tests' }), row({ id: 8, name: 'ui-tests:ios-device' })],
      {
        jobDetails: (_project, _iid, job) => Promise.resolve({ retriedSameFailure: job === 7 }),
      },
    );
    expect(await within(await panel()).findByText(COPY)).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /^ui-tests:ios-device, Failed/ }));

    await within(await panel()).findByText('ui-tests:ios-device');
    await settle();
    expect(within(await panel()).queryByText(COPY)).not.toBeInTheDocument();
    expect(asked).toContain(8);
  });
});
