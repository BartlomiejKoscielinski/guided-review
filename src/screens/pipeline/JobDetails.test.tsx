import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-20.5: the job details panel of S-08 (Pipeline.dc.html, M6 decision 10). The selected job shows
// in <section aria-label="Job details">: the name, the status word (data-testid="job-status",
// the F-20.2 label: "Failed", "Failed · allowed", ...), the meta "<stage> stage · <clock>" (+
// " · started just now" while running, + " · allowed to fail"), the buttons "Retry job" /
// "Cancel job" (exact names; the row's own buttons are "Retry <job>" / "Cancel <job>") and
// "Full log". The log is role="log" named "Job log"; every line is one element with
// data-kind="command|pass|error|plain" (colors come from tokens in CSS) and its text as text.
// While the job runs, role="status" says "Running. The log streams on the left."
//
// Client: `jobTrace(project, iid, job, onEvent)`; `JobRow.webUrl: string | null` is the job's
// page; "Full log" is a <button> that calls `osOpenGitlabUrl(webUrl)` (like Open in GitLab, F-20.4)
// and is disabled without a web URL.
//
// Decisions the tests lock (none is in the spec or the mock):
//  - Full log is a button, not a link, like Open in GitLab.
//  - A waiting or skipped job has no log: the panel shows no "Job log" and the log is not read.
//  - A failed read of the log shows "Couldn't load the log. <reason>" as the one role="alert" of
//    the panel; the buttons stay.
//  - A cut log shows "Showing the last 500 lines. Full log opens it in GitLab." as the first line
//    (data-kind="plain") when an event says `truncated`.

const IID = 482;
const PROJECT = 'mobile/mobile-app';
type Row = Awaited<ReturnType<IpcClient['pipelineJobs']>>[number]['jobs'][number];
type Event = Parameters<Parameters<IpcClient['jobTrace']>[3]>[0];
type Line = Event['lines'][number];

const row = (over: Partial<Row> & Pick<Row, 'id' | 'name'>): Row => ({
  state: 'passed',
  action: null,
  durationSecs: null,
  webUrl: `https://gitlab.local/mobile/mobile-app/-/jobs/${String(over.id)}`,
  ...over,
});
const event = (lines: Line[], over: Partial<Event> = {}): Event => ({
  lines,
  replace: true,
  truncated: false,
  done: false,
  ...over,
});
const cmd = (text: string): Line => ({ kind: 'command', text });
const ok = (text: string): Line => ({ kind: 'pass', text });
const bad = (text: string): Line => ({ kind: 'error', text });
const plain = (text: string): Line => ({ kind: 'plain', text });

interface Opened {
  user: ReturnType<typeof userEvent.setup>;
  traced: number[];
  emit: (e: Event) => Promise<void>;
  calls: string[];
  opened: string[];
  retried: number[];
}

async function openWith(
  rows: Row[],
  override: Partial<IpcClient> = {},
  stage = 'test',
): Promise<Opened> {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const traced: number[] = [];
  const opened: string[] = [];
  const retried: number[] = [];
  let send: (e: Event) => void = () => undefined;
  const rec = recordingClient({
    ...base,
    pipelineJobs: () => Promise.resolve([{ name: stage, jobs: rows }]),
    jobTrace: (_project, _iid, job, onEvent) => {
      traced.push(job);
      send = onEvent;
      return new Promise<void>(() => undefined);
    },
    osOpenGitlabUrl: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    jobRetry: (_project, _iid, job) => {
      retried.push(job);
      return Promise.resolve(row({ id: job + 1000, name: 'x', state: 'running' }));
    },
    ...override,
  });
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: IID })));
  return {
    user: userEvent.setup(),
    traced,
    opened,
    retried,
    calls: rec.calls,
    emit: (e) =>
      act(() => {
        send(e);
        return Promise.resolve();
      }),
  };
}

const panel = async () => screen.findByRole('region', { name: 'Job details' });
const logLines = async () => {
  const log = await screen.findByRole('log', { name: 'Job log' });
  return Array.from(log.querySelectorAll('[data-kind]')).map((c) => ({
    kind: c.getAttribute('data-kind'),
    text: c.textContent,
  }));
};

describe('S-08 job details (F-20.5)', () => {
  it('F-20.5 the selected job shows its name, status, stage and duration', async () => {
    await openWith([
      row({ id: 5, name: 'unit-tests', state: 'failed', action: 'retry', durationSecs: 112 }),
    ]);

    const details = within(await panel());

    expect(details.getByText('unit-tests')).toBeInTheDocument();
    expect(details.getByTestId('job-status')).toHaveTextContent(/^Failed$/);
    expect(details.getByText(/test stage · 1:52/i)).toBeInTheDocument();
  });

  it('F-20.5 an allowed failure says so in the tag and the meta line', async () => {
    await openWith([
      row({
        id: 6,
        name: 'ui-tests:android',
        state: 'failedAllowed',
        action: 'retry',
        durationSecs: 185,
      }),
    ]);

    const details = within(await panel());

    expect(details.getByTestId('job-status')).toHaveTextContent(/^Failed · allowed$/);
    expect(details.getByText(/test stage · 3:05 · allowed to fail/i)).toBeInTheDocument();
  });

  it('F-20.5 a running job says it started just now and has no duration yet', async () => {
    await openWith(
      [row({ id: 7, name: 'build:android', state: 'running', action: 'cancel' })],
      {},
      'build',
    );

    const details = within(await panel());

    expect(details.getByTestId('job-status')).toHaveTextContent(/^Running$/);
    expect(details.getByText(/build stage · started just now/i)).toBeInTheDocument();
  });

  it('F-20.5 a skipped job shows the stage only', async () => {
    await openWith([row({ id: 8, name: 'sonar', state: 'skipped' })]);

    const details = within(await panel());

    expect(details.getByTestId('job-status')).toHaveTextContent(/^Skipped$/);
    expect(details.getByText(/^test stage$/i)).toBeInTheDocument();
  });

  it('F-20.5 a failed job offers Retry job, and the click retries that job', async () => {
    const { user, retried } = await openWith([
      row({ id: 5, name: 'unit-tests', state: 'failed', action: 'retry', durationSecs: 112 }),
    ]);

    const details = within(await panel());
    expect(details.queryByRole('button', { name: 'Cancel job', exact: true })).toBeNull();
    await user.click(details.getByRole('button', { name: 'Retry job', exact: true }));

    expect(retried).toEqual([5]);
  });

  it('F-20.5 a running job offers Cancel job and no Retry job', async () => {
    await openWith([row({ id: 7, name: 'build:android', state: 'running', action: 'cancel' })]);

    const details = within(await panel());

    expect(details.getByRole('button', { name: 'Cancel job', exact: true })).toBeEnabled();
    expect(details.queryByRole('button', { name: 'Retry job', exact: true })).toBeNull();
  });

  it('F-20.5 a passed job offers neither Retry job nor Cancel job, only Full log', async () => {
    await openWith([row({ id: 9, name: 'restore', durationSecs: 48 })]);

    const details = within(await panel());

    expect(details.queryByRole('button', { name: 'Retry job', exact: true })).toBeNull();
    expect(details.queryByRole('button', { name: 'Cancel job', exact: true })).toBeNull();
    expect(details.getByRole('button', { name: 'Full log', exact: true })).toBeEnabled();
  });

  it('F-20.5 Full log opens the job’s page in the browser', async () => {
    const { user, opened } = await openWith([
      row({ id: 5, name: 'unit-tests', state: 'failed', action: 'retry', durationSecs: 112 }),
    ]);

    await user.click(within(await panel()).getByRole('button', { name: 'Full log', exact: true }));

    expect(opened).toEqual(['https://gitlab.local/mobile/mobile-app/-/jobs/5']);
  });

  it('F-20.5 Full log is disabled when GitLab gave no page for the job', async () => {
    await openWith([row({ id: 5, name: 'unit-tests', state: 'failed', webUrl: null })]);

    expect(
      within(await panel()).getByRole('button', { name: 'Full log', exact: true }),
    ).toBeDisabled();
  });

  it('F-20.5 the log is read for the selected job and again for the next one picked', async () => {
    const { user, traced } = await openWith([
      row({ id: 5, name: 'unit-tests', state: 'failed', action: 'retry', durationSecs: 112 }),
      row({ id: 6, name: 'sonar', durationSecs: 130 }),
    ]);
    await panel();
    expect(traced).toEqual([5]);

    await user.click(screen.getByRole('button', { name: 'sonar, Passed', exact: true }));

    expect(traced).toEqual([5, 6]);
  });

  it('F-20.5 a skipped or waiting job has no log and none is read', async () => {
    const { user, traced } = await openWith([
      row({ id: 5, name: 'unit-tests', state: 'failed', action: 'retry', durationSecs: 112 }),
      row({ id: 8, name: 'sonar', state: 'skipped' }),
      row({ id: 9, name: 'dotnet-format', state: 'waiting', action: 'cancel' }),
    ]);
    await panel();

    await user.click(screen.getByRole('button', { name: 'sonar, Skipped', exact: true }));
    await user.click(screen.getByRole('button', { name: 'dotnet-format, Waiting', exact: true }));

    expect(traced).toEqual([5]);
    expect(screen.queryByRole('log', { name: 'Job log' })).toBeNull();
  });

  it('F-20.5 the log lines carry their kind: command, pass, error, plain', async () => {
    const { emit } = await openWith([
      row({ id: 5, name: 'unit-tests', state: 'failed', action: 'retry', durationSecs: 112 }),
    ]);
    await panel();

    await emit(
      event([
        cmd('$ dotnet test tests/App.Tests -c Release'),
        plain('  App.Tests -> App.Tests.dll'),
        bad('Failed!  Failed: 2, Passed: 210'),
        ok('Job succeeded'),
      ]),
    );

    expect(await logLines()).toEqual([
      { kind: 'command', text: '$ dotnet test tests/App.Tests -c Release' },
      { kind: 'plain', text: '  App.Tests -> App.Tests.dll' },
      { kind: 'error', text: 'Failed!  Failed: 2, Passed: 210' },
      { kind: 'pass', text: 'Job succeeded' },
    ]);
  });

  it('F-20.5 new lines are appended to the log and a replace event starts it over', async () => {
    const { emit } = await openWith([
      row({ id: 7, name: 'build:android', state: 'running', action: 'cancel' }),
    ]);
    await panel();

    await emit(event([cmd('$ dotnet build'), plain('  App -> App.dll')]));
    await emit(event([ok('Build succeeded.')], { replace: false }));
    expect((await logLines()).map((l) => l.text)).toEqual([
      '$ dotnet build',
      '  App -> App.dll',
      'Build succeeded.',
    ]);

    await emit(event([cmd('$ dotnet build -f net9.0-android')]));
    expect((await logLines()).map((l) => l.text)).toEqual(['$ dotnet build -f net9.0-android']);
  });

  it('F-20.5 a cut log starts with the line that says so', async () => {
    const { emit } = await openWith([
      row({ id: 5, name: 'unit-tests', state: 'failed', action: 'retry', durationSecs: 112 }),
    ]);
    await panel();

    await emit(event([plain('line 2'), plain('line 3')], { truncated: true }));

    expect(await logLines()).toEqual([
      { kind: 'plain', text: 'Showing the last 500 lines. Full log opens it in GitLab.' },
      { kind: 'plain', text: 'line 2' },
      { kind: 'plain', text: 'line 3' },
    ]);
  });

  it('F-20.5 log text is shown as text, never as HTML', async () => {
    const { emit } = await openWith([
      row({ id: 5, name: 'unit-tests', state: 'failed', action: 'retry', durationSecs: 112 }),
    ]);
    await panel();

    await emit(event([plain('<img src=x onerror=alert(1)>'), plain('<b>bold</b> &amp; more')]));

    const log = await screen.findByRole('log', { name: 'Job log' });
    expect(log.querySelector('img, b, script')).toBeNull();
    expect((await logLines()).map((l) => l.text)).toEqual([
      '<img src=x onerror=alert(1)>',
      '<b>bold</b> &amp; more',
    ]);
  });

  it('F-20.5 a running job says the log streams on the left; a finished one does not', async () => {
    await openWith([row({ id: 7, name: 'build:android', state: 'running', action: 'cancel' })]);

    expect(await within(await panel()).findByRole('status')).toHaveTextContent(
      /^Running\. The log streams on the left\.$/,
    );
  });

  it('F-20.5 a failed job shows no running note', async () => {
    await openWith([row({ id: 5, name: 'unit-tests', state: 'failed', action: 'retry' })]);

    const details = within(await panel());

    expect(details.queryByText('Running. The log streams on the left.')).toBeNull();
  });

  it('F-20.5 a log that cannot be read says so with the reason and keeps the buttons', async () => {
    await openWith(
      [row({ id: 5, name: 'unit-tests', state: 'failed', action: 'retry', durationSecs: 112 })],
      {
        jobTrace: () =>
          Promise.reject(
            new IpcError({
              code: 'GITLAB_NETWORK',
              message: 'GitLab is not answering.',
              retryable: true,
            }),
          ),
      },
    );

    const details = within(await panel());

    expect(await details.findByRole('alert')).toHaveTextContent(
      /^Couldn't load the log\. GitLab is not answering\.$/,
    );
    expect(details.getByRole('button', { name: 'Retry job', exact: true })).toBeEnabled();
  });
});
