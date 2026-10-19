import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import type { IpcClient } from '../client';

// F-20.5 in the mock backend, as the core answers `job_trace(project, iid, job, ch)` (plan M6,
// decision 10): the client call is `jobTrace(project, iid, job, onEvent)`; `onEvent` gets
// `{ lines: { kind, text }[], replace, truncated, done }` (kind: command | pass | error | plain)
// and the returned promise settles when the stream ends (the job finished).
//
// The logs are those of Pipeline.dc.html (LOGS / genericLog), job ids `<pipeline><index>`:
//   1832104  unit-tests of #18321 (failed): 7 lines, finished
//   1832105  not used here
//   1835102  build:android of #18351 (the new pipeline, running): its log is still growing
// `jobRow.webUrl` is the job's page on the mock server.

const PROJECT = 'mobile/mobile-app';
const IID = 482;

type Event = Parameters<Parameters<IpcClient['jobTrace']>[3]>[0];

async function backend() {
  const mock = createMockClient({ latencyMs: 0 });
  await mock.repoPick();
  return mock;
}

describe('mock job log (F-20.5)', () => {
  it('F-20.5 a failed job’s log arrives at once, in full, with its line kinds', async () => {
    const mock = await backend();
    const events: Event[] = [];

    await mock.jobTrace(PROJECT, IID, 1832104, (e) => events.push(e));

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.replace).toBe(true);
    expect(event?.done).toBe(true);
    expect(event?.truncated).toBe(false);
    expect(event?.lines).toEqual([
      { kind: 'command', text: '$ dotnet test tests/App.Tests -c Release --logger junit' },
      { kind: 'plain', text: '  App.Tests -> tests/App.Tests/bin/Release/net9.0/App.Tests.dll' },
      {
        kind: 'error',
        text: '  Failed  SqliteUploadQueueTests.Dequeue_ReturnsOldestFirst [41 ms]',
      },
      { kind: 'error', text: '    Expected: "photo-1"  But was: "photo-3"' },
      {
        kind: 'error',
        text: '  Failed  SqliteUploadQueueTests.Dequeue_AfterRestart_KeepsOrder [55 ms]',
      },
      { kind: 'error', text: 'Failed!  Failed: 2, Passed: 210, Skipped: 0, Total: 212' },
      { kind: 'error', text: 'ERROR: Job failed: exit code 1' },
    ]);
  });

  it('F-20.5 a passed job’s log ends with the pass line “Job succeeded”', async () => {
    const mock = await backend();
    const events: Event[] = [];

    await mock.jobTrace(PROJECT, IID, 1834204, (e) => events.push(e));

    const lines = events.flatMap((e) => e.lines);
    expect(lines[0]).toEqual({
      kind: 'command',
      text: '$ dotnet test tests/App.Tests -c Release --logger junit',
    });
    expect(lines[lines.length - 1]).toEqual({ kind: 'pass', text: 'Job succeeded' });
  });

  it('F-20.5 a running job’s log starts with two lines and then grows by new lines only', async () => {
    const mock = await backend();
    await mock.pipelineRunMr(PROJECT, IID);
    const events: Event[] = [];

    void mock.jobTrace(PROJECT, IID, 1835102, (e) => events.push(e));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events[0]?.replace).toBe(true);
    expect(events[0]?.done).toBe(false);
    expect(events[0]?.lines).toEqual([
      { kind: 'command', text: '$ dotnet build src/App -c Release -f net9.0-android' },
      { kind: 'plain', text: '  App -> src/App/bin/Release/App.dll' },
    ]);
    await expect.poll(() => events.length, { timeout: 8000 }).toBeGreaterThan(1);
    expect(events[1]?.replace).toBe(false);
    expect(events[1]?.done).toBe(false);
    expect(events[1]?.lines).toEqual([
      { kind: 'pass', text: 'Build succeeded. 0 Warning(s) 0 Error(s)' },
    ]);
  }, 15_000);

  it('F-20.5 an unknown job is GitLab’s 404', async () => {
    const mock = await backend();

    await expect(mock.jobTrace(PROJECT, IID, 42, () => undefined)).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
    });
  });

  it('F-20.5 every job row has its page on the mock server as webUrl', async () => {
    const mock = await backend();

    const columns = await mock.pipelineJobs(PROJECT, IID, 18321);

    const unitTests = columns.flatMap((c) => c.jobs).find((j) => j.name === 'unit-tests');
    expect(unitTests?.webUrl).toBe('https://gitlab.local/mobile/mobile-app/-/jobs/1832104');
  });
});
