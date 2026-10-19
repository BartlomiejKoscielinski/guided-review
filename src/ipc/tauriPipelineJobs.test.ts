import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createTauriClient } from './tauri';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (message: unknown) => void = () => undefined;
  },
}));
const invokeMock = vi.mocked(invoke);

// F-20.2: `pipeline_jobs(project, iid, pipeline)`, `job_retry(project, iid, job)` and
// `job_cancel(project, iid, job)` (docs/04 › IPC contract, plan M6). The answers are the core's
// StageColumn list and JobRow in camelCase, handed on as they are.

const row = {
  id: 105,
  name: 'ui-tests:android',
  state: 'failedAllowed',
  action: 'retry',
  durationSecs: 185,
};

describe('Tauri IPC client: pipeline jobs (F-20.2)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('F-20.2 pipeline_jobs sends the project, the iid and the pipeline id and returns the core columns as they are', async () => {
    const columns = [{ name: 'test', jobs: [row] }];
    invokeMock.mockResolvedValue(columns);
    const client = createTauriClient();

    await expect(client.pipelineJobs('mobile/mobile-app', 482, 18342)).resolves.toEqual(columns);

    expect(invokeMock.mock.calls).toEqual([
      ['pipeline_jobs', { project: 'mobile/mobile-app', iid: 482, pipeline: 18342 }],
    ]);
  });

  it('F-20.2 job_retry sends the project, the iid and the job id and returns the new attempt as it is', async () => {
    const attempt = { ...row, id: 230, state: 'waiting', action: 'cancel', durationSecs: null };
    invokeMock.mockResolvedValue(attempt);
    const client = createTauriClient();

    await expect(client.jobRetry('mobile/mobile-app', 482, 105)).resolves.toEqual(attempt);

    expect(invokeMock.mock.calls).toEqual([
      ['job_retry', { project: 'mobile/mobile-app', iid: 482, job: 105 }],
    ]);
  });

  it('F-20.2 job_cancel sends the project, the iid and the job id and returns the canceled row as it is', async () => {
    const canceled = { ...row, id: 104, state: 'canceled', action: 'retry' };
    invokeMock.mockResolvedValue(canceled);
    const client = createTauriClient();

    await expect(client.jobCancel('mobile/mobile-app', 482, 104)).resolves.toEqual(canceled);

    expect(invokeMock.mock.calls).toEqual([
      ['job_cancel', { project: 'mobile/mobile-app', iid: 482, job: 104 }],
    ]);
  });
});
