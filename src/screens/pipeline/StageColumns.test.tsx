import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-20.2: S-08's stage columns (Pipeline.dc.html, M6 decisions 5 to 7). Against the mock
// backend's !482 and against replaced `pipelineJobs(project, iid, pipeline)`, `jobRetry` and
// `jobCancel` answers for the rest.
//
// Locators the screen keeps:
//  - one <section aria-label="<stage name>"> (role region) per stage, in the order the core gives,
//    holding an <h2> with the stage name (compared without case: GitLab's own are lower case, CSS
//    uppercases) and data-testid="stage-count" with "3 jobs" / "1 job".
//  - one data-testid="job-row" per job holding two sibling <button>s, never nested:
//      the select button <button aria-pressed aria-label="<name>, <Label>"> with the labels
//        Passed, Failed, "Failed · allowed", Running, Waiting, Manual, Canceled, Skipped;
//        inside it data-testid="job-square" with data-state="<state of the core>" holding an
//        aria-hidden <svg><path d="…"> of the mock (none for waiting), the job name as text, and
//        data-testid="job-meta" with the duration ("6:12"), "running", "manual" or "skipped";
//        waiting and canceled rows have no text there (absent or empty);
//      and, when the row has an action, a second <button aria-label="Retry <name>" /
//        "Run <name>" / "Cancel <name>"> with the same text as its title.
//  - a failed Retry, Cancel or jobs read shows role="alert" with the error message.

const PROJECT = 'mobile/mobile-app';
const IID = 482;
/** Commands that run GitLab work; a restored screen calls none of them (F-30.4). */
const WORK = /^(review|gitlab|pipeline|job|claude(?!Status$|Models$|Activity$))/;

type Column = Awaited<ReturnType<IpcClient['pipelineJobs']>>[number];
type Row = Column['jobs'][number];

const row = (over: Partial<Row> & Pick<Row, 'name'>): Row => ({
  id: 1,
  state: 'passed',
  action: null,
  durationSecs: null,
  ...over,
});

/** `override` may be a function of the base mock client, to wrap its commands. */
type Override = Partial<IpcClient> | ((base: IpcClient) => Partial<IpcClient>);

async function backend(override: Override = {}) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  return recordingClient({
    ...base,
    ...(typeof override === 'function' ? override(base) : override),
  });
}

async function openPipeline(override: Override = {}) {
  const rec = await backend(override);
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: IID })));
  return { ...app, ...rec };
}

/** The columns answered by hand: one stage "test" with these rows. */
function jobsOf(...rows: Row[]): Partial<IpcClient> {
  return { pipelineJobs: () => Promise.resolve([{ name: 'test', jobs: rows }]) };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The select button of a job (its name is "<job>, <Label>"). */
const select = (name: string, label?: string) =>
  screen.getByRole('button', {
    name: label === undefined ? new RegExp(`^${escape(name)}, `) : `${name}, ${label}`,
  });
const rowOf = (name: string) => {
  const found = select(name).closest('[data-testid="job-row"]');
  if (!(found instanceof HTMLElement)) throw new Error(`no row for ${name}`);
  return found;
};
const region = (name: RegExp) => screen.findByRole('region', { name });
const columns = () => screen.findByRole('region', { name: /^build$/i });
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('S-08 stage columns from the mock backend (F-20.2)', () => {
  it('F-20.2 reads the jobs of the shown pipeline of the active repository’s project', async () => {
    const pipelineJobs = vi.fn<IpcClient['pipelineJobs']>(() => Promise.resolve([]));
    await openPipeline({ pipelineJobs });

    await waitFor(() => {
      expect(pipelineJobs).toHaveBeenCalledWith(PROJECT, IID, 18342);
    });
    expect(pipelineJobs).not.toHaveBeenCalledWith(PROJECT, IID, 18321);
  });

  it('F-20.2 shows the stages as columns in the core’s order, each with its heading and job count', async () => {
    await openPipeline();

    await columns();
    const regions = screen.getAllByRole('region').filter((r) => r.tagName === 'SECTION');
    expect(regions.map((r) => within(r).getByRole('heading', { level: 2 }).textContent)).toEqual([
      expect.stringMatching(/^build$/i),
      expect.stringMatching(/^test$/i),
      expect.stringMatching(/^quality$/i),
      expect.stringMatching(/^distribute$/i),
    ]);
    expect(regions.map((r) => within(r).getByTestId('stage-count').textContent)).toEqual([
      '3 jobs',
      '3 jobs',
      '2 jobs',
      '1 job',
    ]);
  });

  it('F-20.2 each column lists its jobs in order, one row each', async () => {
    await openPipeline();

    const build = await columns();
    expect(
      within(build)
        .getAllByTestId('job-row')
        .map((r) => within(r).getAllByRole('button')[0]?.getAttribute('aria-label')),
    ).toEqual(['restore, Passed', 'build:android, Passed', 'build:ios, Passed']);
    const test = await region(/^test$/i);
    expect(
      within(test)
        .getAllByTestId('job-row')
        .map((r) => within(r).getAllByRole('button')[0]?.getAttribute('aria-label')),
    ).toEqual([
      'unit-tests, Passed',
      'ui-tests:android, Failed · allowed',
      'ui-tests:ios-device, Manual',
    ]);
    const quality = await region(/^quality$/i);
    expect(within(quality).getAllByTestId('job-row')).toHaveLength(2);
    const distribute = await region(/^distribute$/i);
    expect(
      within(within(distribute).getByTestId('job-row')).getAllByRole('button')[0],
    ).toHaveAccessibleName('distribute:qa, Manual');
  });

  it('F-20.2 each row gives its duration or its state as the mock does', async () => {
    await openPipeline();
    await columns();

    const meta = (name: string) => within(rowOf(name)).getByTestId('job-meta').textContent;
    expect(meta('restore')).toBe('0:48');
    expect(meta('build:android')).toBe('6:12');
    expect(meta('build:ios')).toBe('7:40');
    expect(meta('unit-tests')).toBe('1:52');
    expect(meta('ui-tests:android')).toBe('3:05');
    expect(meta('ui-tests:ios-device')).toBe('manual');
    expect(meta('dotnet-format')).toBe('0:22');
    expect(meta('sonar')).toBe('2:10');
    expect(meta('distribute:qa')).toBe('manual');
  });

  it('F-20.2 the actions of #18342 are Retry on the allowed failure and Run on the two manual jobs, none elsewhere', async () => {
    await openPipeline();
    await columns();

    expect(screen.getByRole('button', { name: 'Retry ui-tests:android' })).toHaveAttribute(
      'title',
      'Retry ui-tests:android',
    );
    expect(screen.getByRole('button', { name: 'Run ui-tests:ios-device' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run distribute:qa' })).toBeInTheDocument();
    for (const name of ['restore', 'build:android', 'build:ios', 'unit-tests', 'sonar']) {
      expect(within(rowOf(name)).getAllByRole('button'), name).toHaveLength(1);
    }
    expect(screen.queryByRole('button', { name: /^Retry (unit-tests|sonar|restore)/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cancel / })).toBeNull();
  });

  it('F-20.2 switching to #18321 shows its jobs: unit-tests Failed with Retry, the later jobs Skipped without a button', async () => {
    const user = userEvent.setup();
    const { calls } = await openPipeline();
    await columns();

    await user.click(await screen.findByRole('tab', { name: /#18321/ }));

    await waitFor(() => {
      expect(select('unit-tests', 'Failed')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Retry unit-tests' })).toBeInTheDocument();
    for (const name of ['ui-tests:ios-device', 'dotnet-format', 'sonar', 'distribute:qa']) {
      expect(select(name, 'Skipped')).toBeInTheDocument();
      expect(within(rowOf(name)).getAllByRole('button')).toHaveLength(1);
    }
    expect(within(rowOf('sonar')).getByTestId('job-meta')).toHaveTextContent(/^skipped$/);
    expect(calls.filter((c) => c === 'pipelineJobs').length).toBeGreaterThanOrEqual(2);
  });

  it('F-20.2 switching to #18320 shows restore Passed and every other job Canceled with Retry and no text on the right', async () => {
    const user = userEvent.setup();
    await openPipeline();
    await columns();

    await user.click(await screen.findByRole('tab', { name: /#18320/ }));

    await waitFor(() => {
      expect(select('build:android', 'Canceled')).toBeInTheDocument();
    });
    expect(select('restore', 'Passed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry build:android' })).toBeInTheDocument();
    // The eight row Retries; the head's "Retry failed jobs" (F-20.4) is not a row button.
    expect(screen.getAllByRole('button', { name: /^Retry (?!failed jobs$)/ })).toHaveLength(8);
    const right = within(rowOf('build:android')).queryByTestId('job-meta');
    expect(right?.textContent ?? '').toBe('');
  });
});

describe('S-08 job row states (F-20.2)', () => {
  const CHECK = 'M3 8.5l3.2 3L13 4.5';
  const CROSS = 'M3.5 3.5l9 9M12.5 3.5l-9 9';
  const WARN = 'M8 2.5v7M8 12.5v1';
  const SPIN = 'M8 2a6 6 0 1 1-6 6';
  const PLAY = 'M4 2.5v11l9.5-5.5z';
  const SLASH = 'M3 13 13 3';

  const STATES: [Row['state'], string, string | null, number | null, string, string | null][] = [
    ['passed', 'Passed', CHECK, 48, '0:48', null],
    ['failed', 'Failed', CROSS, 112, '1:52', 'Retry'],
    ['failedAllowed', 'Failed · allowed', WARN, 185, '3:05', 'Retry'],
    ['running', 'Running', SPIN, null, 'running', 'Cancel'],
    ['waiting', 'Waiting', null, null, '', 'Cancel'],
    ['manual', 'Manual', PLAY, null, 'manual', 'Run'],
    ['canceled', 'Canceled', CROSS, null, '', 'Retry'],
    ['skipped', 'Skipped', SLASH, null, 'skipped', null],
  ];

  it.each(STATES)(
    'F-20.2 a %s job reads "%s" for screen readers and draws its own square and icon',
    async (state, label, icon) => {
      await openPipeline(jobsOf(row({ id: 7, name: 'sonar', state })));

      const button = await screen.findByRole('button', { name: `sonar, ${label}` });
      const square = within(button).getByTestId('job-square');
      expect(square).toHaveAttribute('data-state', state);
      const path = square.querySelector('svg path');
      expect(path?.getAttribute('d') ?? null).toBe(icon);
      if (icon !== null) expect(square.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    },
  );

  it.each(STATES)(
    'F-20.2 a %s job shows its duration or its state on the right',
    async (state, label, _icon, durationSecs, meta) => {
      await openPipeline(jobsOf(row({ id: 7, name: 'sonar', state, durationSecs })));

      expect(await screen.findByRole('button', { name: `sonar, ${label}` })).toBeInTheDocument();
      expect(within(rowOf('sonar')).queryByTestId('job-meta')?.textContent ?? '').toBe(meta);
    },
  );

  it.each(STATES)(
    'F-20.2 a %s job’s core action shows as one separate button named after the job',
    async (state, _label, _icon, durationSecs, _meta, action) => {
      const core = action === null ? null : (action.toLowerCase() as Row['action']);
      await openPipeline(jobsOf(row({ id: 7, name: 'sonar', state, durationSecs, action: core })));

      await screen.findByRole('button', { name: /^sonar, / });
      const buttons = within(rowOf('sonar')).getAllByRole('button');
      expect(buttons).toHaveLength(action === null ? 1 : 2);
      if (action !== null) {
        expect(buttons[1]).toHaveAccessibleName(`${action} sonar`);
        expect(buttons[1]).toHaveAttribute('title', `${action} sonar`);
        expect(buttons[0]?.contains(buttons[1] ?? null)).toBe(false);
        expect(buttons[1]?.contains(buttons[0] ?? null)).toBe(false);
      }
    },
  );

  it('F-20.2 a duration reads minutes and seconds, and hours when it takes that long', async () => {
    await openPipeline(
      jobsOf(
        row({ id: 1, name: 'zero', durationSecs: 0 }),
        row({ id: 2, name: 'short', durationSecs: 5 }),
        row({ id: 3, name: 'long', durationSecs: 3725 }),
      ),
    );

    await screen.findByRole('button', { name: 'zero, Passed' });
    const meta = (name: string) => within(rowOf(name)).getByTestId('job-meta').textContent;
    expect(meta('zero')).toBe('0:00');
    expect(meta('short')).toBe('0:05');
    expect(meta('long')).toBe('1:02:05');
  });

  it('F-20.2 the stage names are the core’s own and the count says "1 job" or "2 jobs"', async () => {
    await openPipeline({
      pipelineJobs: () =>
        Promise.resolve([
          { name: 'build', jobs: [row({ id: 1, name: 'a' })] },
          { name: 'deploy', jobs: [row({ id: 2, name: 'b' }), row({ id: 3, name: 'c' })] },
        ]),
    });

    const build = await region(/^build$/i);
    expect(within(build).getByTestId('stage-count')).toHaveTextContent(/^1 job$/);
    const deploy = await region(/^deploy$/i);
    expect(within(deploy).getByTestId('stage-count')).toHaveTextContent(/^2 jobs$/);
  });
});

describe('S-08 selecting a job (F-20.2)', () => {
  it('F-20.2 the first job that did not pass is selected when the pipeline opens: ui-tests:android of #18342', async () => {
    await openPipeline();
    await columns();

    expect(select('ui-tests:android')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
  });

  it('F-20.2 the first job is selected when every job passed', async () => {
    await openPipeline(
      jobsOf(row({ id: 1, name: 'alpha' }), row({ id: 2, name: 'beta', durationSecs: 3 })),
    );

    expect(await screen.findByRole('button', { name: 'alpha, Passed' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(select('beta')).toHaveAttribute('aria-pressed', 'false');
  });

  it('F-20.2 picking the second tab selects the first job that did not pass there: unit-tests of #18321', async () => {
    const user = userEvent.setup();
    await openPipeline();
    await columns();

    await user.click(await screen.findByRole('tab', { name: /#18321/ }));

    await waitFor(() => {
      expect(select('unit-tests')).toHaveAttribute('aria-pressed', 'true');
    });
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
  });

  it('F-20.2 a click on a row selects it alone and requests nothing', async () => {
    const user = userEvent.setup();
    const { calls } = await openPipeline();
    await columns();
    const before = calls.length;

    await user.click(select('sonar'));

    expect(select('sonar')).toHaveAttribute('aria-pressed', 'true');
    expect(select('ui-tests:android')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
    expect(calls.slice(before).filter((c) => /^job/.test(c))).toEqual([]);
  });

  it('F-20.2 Run on a manual job only selects it: no request, no change of its state, no confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await openPipeline();
    await columns();
    const before = calls.length;

    await user.click(screen.getByRole('button', { name: 'Run distribute:qa' }));

    expect(select('distribute:qa', 'Manual')).toHaveAttribute('aria-pressed', 'true');
    expect(select('ui-tests:android')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Run distribute:qa' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(calls.slice(before).filter((c) => /^(job|gitlab)/.test(c))).toEqual([]);
  });

  it('F-20.2 Run does not call jobRetry, jobCancel or anything that plays a job, however often it is clicked', async () => {
    const user = userEvent.setup();
    const jobRetry = vi.fn<IpcClient['jobRetry']>();
    const jobCancel = vi.fn<IpcClient['jobCancel']>();
    await openPipeline({ jobRetry, jobCancel });
    await columns();

    await user.click(screen.getByRole('button', { name: 'Run ui-tests:ios-device' }));
    await user.click(screen.getByRole('button', { name: 'Run ui-tests:ios-device' }));

    expect(jobRetry).not.toHaveBeenCalled();
    expect(jobCancel).not.toHaveBeenCalled();
    expect(select('ui-tests:ios-device')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('S-08 Retry and Cancel act at once (F-20.2, decision 6)', () => {
  /** #18321, unit-tests is the failed job. */
  async function openFailed(override: Override = {}) {
    const user = userEvent.setup();
    const app = await openPipeline(override);
    await columns();
    await user.click(await screen.findByRole('tab', { name: /#18321/ }));
    await screen.findByRole('button', { name: 'Retry unit-tests' });
    return { ...app, user };
  }

  it('F-20.2 Retry sends jobRetry at once, without a dialog, and the row runs with a Cancel button', async () => {
    let jobRetry = vi.fn<IpcClient['jobRetry']>();
    const { user } = await openFailed((base) => {
      jobRetry = vi.fn<IpcClient['jobRetry']>((...a) => base.jobRetry(...a));
      return { jobRetry };
    });

    await user.click(screen.getByRole('button', { name: 'Retry unit-tests' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(jobRetry).toHaveBeenCalledTimes(1);
    expect(jobRetry.mock.calls[0]?.slice(0, 2)).toEqual([PROJECT, IID]);
    expect(await screen.findByRole('button', { name: 'unit-tests, Running' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel unit-tests' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry unit-tests' })).toBeNull();
    expect(within(rowOf('unit-tests')).getByTestId('job-meta')).toHaveTextContent(/^running$/);
  });

  it('F-20.2 Retry sends the id of the job the row shows', async () => {
    const jobRetry = vi.fn<IpcClient['jobRetry']>(() =>
      Promise.resolve(row({ id: 9001, name: 'unit-tests', state: 'running', action: 'cancel' })),
    );
    const user = userEvent.setup();
    await openPipeline({
      jobRetry,
      pipelineJobs: () =>
        Promise.resolve([
          {
            name: 'test',
            jobs: [
              row({ id: 55, name: 'unit-tests', state: 'failed', action: 'retry' }),
              row({ id: 56, name: 'sonar', state: 'failed', action: 'retry' }),
            ],
          },
        ]),
    });

    await user.click(await screen.findByRole('button', { name: 'Retry sonar' }));

    expect(jobRetry).toHaveBeenCalledWith(PROJECT, IID, 56);
  });

  it('F-20.2 Retry selects the row and the selection follows the new attempt of the same name', async () => {
    const { user } = await openFailed();
    await user.click(select('sonar'));
    expect(select('sonar')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Retry unit-tests' }));

    await waitFor(() => {
      expect(select('unit-tests', 'Running')).toHaveAttribute('aria-pressed', 'true');
    });
    expect(select('sonar')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
  });

  it('F-20.2 after the jobs are read again the retried row is still the selected one, whatever the new job id', async () => {
    let attempt = 0;
    const retried = row({ id: 900, name: 'unit-tests', state: 'running', action: 'cancel' });
    const pipelineJobs = vi.fn<IpcClient['pipelineJobs']>(() =>
      Promise.resolve([
        {
          name: 'test',
          jobs:
            attempt === 0
              ? [
                  row({ id: 1, name: 'alpha' }),
                  row({ id: 2, name: 'unit-tests', state: 'failed', action: 'retry' }),
                ]
              : [row({ id: 1, name: 'alpha' }), retried],
        },
      ]),
    );
    const jobRetry = vi.fn<IpcClient['jobRetry']>(() => {
      attempt = 1;
      return Promise.resolve(retried);
    });
    const user = userEvent.setup();
    await openPipeline({ pipelineJobs, jobRetry });
    await user.click(await screen.findByRole('button', { name: 'Retry unit-tests' }));

    await screen.findByRole('button', { name: 'unit-tests, Running' });
    await waitFor(() => {
      expect(pipelineJobs.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(select('unit-tests', 'Running')).toHaveAttribute('aria-pressed', 'true');
    expect(select('alpha')).toHaveAttribute('aria-pressed', 'false');
  });

  it('F-20.2 while a Retry is on its way its button is disabled, so a second click sends nothing', async () => {
    const pending = deferred<Row>();
    const jobRetry = vi.fn<IpcClient['jobRetry']>(() => pending.promise);
    const { user } = await openFailed({ jobRetry });

    await user.click(screen.getByRole('button', { name: 'Retry unit-tests' }));
    await user.click(screen.getByRole('button', { name: 'Retry unit-tests' }));

    expect(jobRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Retry unit-tests' })).toBeDisabled();
    await act(async () => {
      pending.resolve(row({ id: 77, name: 'unit-tests', state: 'running', action: 'cancel' }));
      await pending.promise;
    });
  });

  it('F-20.2 a refused Retry shows GitLab’s message as an alert and leaves the row failed with Retry disabled', async () => {
    const jobRetry = vi.fn<IpcClient['jobRetry']>(() =>
      Promise.reject(
        new IpcError({
          code: 'GITLAB_FORBIDDEN',
          message: '403 Forbidden',
          retryable: false,
        }),
      ),
    );
    const { user } = await openFailed({ jobRetry });

    await user.click(screen.getByRole('button', { name: 'Retry unit-tests' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('403 Forbidden');
    expect(select('unit-tests', 'Failed')).toBeInTheDocument();
    // F-20.4 (M6 decision 9): after a 403 the row's Retry stays disabled until the screen reopens.
    expect(screen.getByRole('button', { name: 'Retry unit-tests' })).toBeDisabled();
  });

  it('F-20.2 Cancel sends jobCancel with the job id at once, without a dialog, and the row reads Canceled with Retry', async () => {
    const user = userEvent.setup();
    const jobCancel = vi.fn<IpcClient['jobCancel']>(() =>
      Promise.resolve(row({ id: 31, name: 'sonar', state: 'canceled', action: 'retry' })),
    );
    let canceled = false;
    await openPipeline({
      jobCancel: (...args) => {
        canceled = true;
        return jobCancel(...args);
      },
      pipelineJobs: () =>
        Promise.resolve([
          {
            name: 'quality',
            jobs: [
              canceled
                ? row({ id: 31, name: 'sonar', state: 'canceled', action: 'retry' })
                : row({ id: 31, name: 'sonar', state: 'running', action: 'cancel' }),
            ],
          },
        ]),
    });

    await user.click(await screen.findByRole('button', { name: 'Cancel sonar' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(jobCancel).toHaveBeenCalledWith(PROJECT, IID, 31);
    expect(await screen.findByRole('button', { name: 'sonar, Canceled' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry sonar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel sonar' })).toBeNull();
  });

  it('F-20.2 Cancel leaves the selection where it was', async () => {
    const user = userEvent.setup();
    const jobCancel = vi.fn<IpcClient['jobCancel']>(() =>
      Promise.resolve(row({ id: 2, name: 'sonar', state: 'canceled', action: 'retry' })),
    );
    await openPipeline({
      jobCancel,
      pipelineJobs: () =>
        Promise.resolve([
          {
            name: 'quality',
            jobs: [
              row({ id: 1, name: 'alpha' }),
              row({ id: 2, name: 'sonar', state: 'running', action: 'cancel' }),
            ],
          },
        ]),
    });
    await screen.findByRole('button', { name: 'Cancel sonar' });
    await user.click(select('alpha'));

    await user.click(screen.getByRole('button', { name: 'Cancel sonar' }));

    expect(jobCancel).toHaveBeenCalledTimes(1);
    expect(select('alpha')).toHaveAttribute('aria-pressed', 'true');
    expect(select('sonar')).toHaveAttribute('aria-pressed', 'false');
  });

  it('F-20.2 a refused Cancel shows GitLab’s message as an alert and leaves the row running', async () => {
    const user = userEvent.setup();
    const jobCancel = vi.fn<IpcClient['jobCancel']>(() =>
      Promise.reject(
        new IpcError({ code: 'GITLAB_FORBIDDEN', message: '403 Forbidden', retryable: false }),
      ),
    );
    await openPipeline({
      jobCancel,
      ...jobsOf(row({ id: 2, name: 'sonar', state: 'running', action: 'cancel' })),
    });

    await user.click(await screen.findByRole('button', { name: 'Cancel sonar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('403 Forbidden');
    expect(select('sonar', 'Running')).toBeInTheDocument();
    // F-20.4 (M6 decision 9): after a 403 the row's Cancel stays disabled until the screen reopens.
    expect(screen.getByRole('button', { name: 'Cancel sonar' })).toBeDisabled();
  });
});

describe('S-08 columns while loading, on errors and restored (F-20.2)', () => {
  it('F-20.2 while the jobs load no column is drawn and nothing is claimed', async () => {
    const pending = deferred<Column[]>();
    await openPipeline({ pipelineJobs: () => pending.promise });

    await screen.findByRole('tab', { name: /#18342/ });
    expect(screen.queryAllByRole('region').filter((r) => r.tagName === 'SECTION')).toHaveLength(0);
    expect(screen.queryByTestId('job-row')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {
      pending.resolve([]);
      await pending.promise;
    });
  });

  it('F-20.2 a failed jobs read shows the error as an alert and keeps the tabs', async () => {
    await openPipeline({
      pipelineJobs: () =>
        Promise.reject(
          new IpcError({
            code: 'GITLAB_NOT_FOUND',
            message: "GitLab didn't find it.",
            retryable: false,
          }),
        ),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent("GitLab didn't find it.");
    expect(screen.getByRole('tab', { name: /#18342/ })).toBeInTheDocument();
    expect(screen.queryByTestId('job-row')).toBeNull();
  });

  it('F-20.2 a restored start (F-30.4) reads no jobs and draws no column', async () => {
    const rec = await backend();
    renderApp({ screen: 'S-08', iid: IID }, rec.client);

    expect(await screen.findByText('Open the pipeline again to load it.')).toBeInTheDocument();
    expect(screen.queryByTestId('job-row')).toBeNull();
    expect(rec.calls.filter((c) => WORK.test(c))).toEqual([]);
  });
});

describe('S-08 live updates (F-20.2, decision 7)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A client whose jobs answer from `rounds` (the last one repeats) and count their reads. */
  function polled(rounds: Row[][]) {
    let index = 0;
    const pipelineJobs = vi.fn<IpcClient['pipelineJobs']>(() => {
      const rows = rounds[Math.min(index, rounds.length - 1)] ?? [];
      index += 1;
      return Promise.resolve([{ name: 'test', jobs: rows }]);
    });
    return pipelineJobs;
  }

  const running = row({ id: 1, name: 'sonar', state: 'running', action: 'cancel' });
  const done = row({ id: 1, name: 'sonar', state: 'passed', durationSecs: 9 });

  it('F-20.2 a pipeline with a running job re-reads its jobs and its head every 5 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pipelineJobs = polled([[running]]);
    let pipelineGet = vi.fn<IpcClient['pipelineGet']>();
    await openPipeline((base) => {
      pipelineGet = vi.fn<IpcClient['pipelineGet']>((...a) => base.pipelineGet(...a));
      return { pipelineJobs, pipelineGet };
    });
    await screen.findByRole('button', { name: 'sonar, Running' });
    const jobsBefore = pipelineJobs.mock.calls.length;
    const headsBefore = pipelineGet.mock.calls.length;

    await act(() => vi.advanceTimersByTimeAsync(2_500));
    expect(pipelineJobs.mock.calls.length).toBe(jobsBefore);

    await act(() => vi.advanceTimersByTimeAsync(3_500));
    expect(pipelineJobs.mock.calls.length).toBe(jobsBefore + 1);
    expect(pipelineGet.mock.calls.length).toBeGreaterThan(headsBefore);

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(pipelineJobs.mock.calls.length).toBe(jobsBefore + 2);
  });

  it('F-20.2 a waiting job (created, pending) is polled too, until it is manual or running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const waiting = row({ id: 1, name: 'sonar', state: 'waiting', action: 'cancel' });
    const manual = row({ id: 1, name: 'sonar', state: 'manual', action: 'run' });
    const pipelineJobs = polled([[waiting], [manual]]);
    await openPipeline({ pipelineJobs });
    await screen.findByRole('button', { name: 'sonar, Waiting' });

    await act(() => vi.advanceTimersByTimeAsync(5_500));
    await screen.findByRole('button', { name: 'sonar, Manual' });
    const settled = pipelineJobs.mock.calls.length;

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(pipelineJobs.mock.calls.length).toBe(settled);
  });

  it('F-20.2 polling stops when the last running job finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pipelineJobs = polled([[running], [done]]);
    await openPipeline({ pipelineJobs });
    await screen.findByRole('button', { name: 'sonar, Running' });

    await act(() => vi.advanceTimersByTimeAsync(5_500));
    await screen.findByRole('button', { name: 'sonar, Passed' });
    const settled = pipelineJobs.mock.calls.length;

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(pipelineJobs.mock.calls.length).toBe(settled);
  });

  it('F-20.2 a finished pipeline is not polled: passed, failed, manual and skipped jobs only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pipelineJobs = polled([
      [
        done,
        row({ id: 2, name: 'unit', state: 'failed', action: 'retry' }),
        row({ id: 3, name: 'ship', state: 'manual', action: 'run' }),
        row({ id: 4, name: 'later', state: 'skipped' }),
        row({ id: 5, name: 'old', state: 'canceled', action: 'retry' }),
      ],
    ]);
    let pipelineGet = vi.fn<IpcClient['pipelineGet']>();
    await openPipeline((base) => {
      pipelineGet = vi.fn<IpcClient['pipelineGet']>((...a) => base.pipelineGet(...a));
      return { pipelineJobs, pipelineGet };
    });
    await screen.findByRole('button', { name: 'unit, Failed' });
    const jobsBefore = pipelineJobs.mock.calls.length;
    const headsBefore = pipelineGet.mock.calls.length;

    await act(() => vi.advanceTimersByTimeAsync(30_000));

    expect(pipelineJobs.mock.calls.length).toBe(jobsBefore);
    expect(pipelineGet.mock.calls.length).toBe(headsBefore);
  });

  it('F-20.2 closing the screen stops the polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pipelineJobs = polled([[running]]);
    const app = await openPipeline({ pipelineJobs });
    await screen.findByRole('button', { name: 'sonar, Running' });

    app.unmount();
    const settled = pipelineJobs.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(30_000));

    expect(pipelineJobs.mock.calls.length).toBe(settled);
  });
});
