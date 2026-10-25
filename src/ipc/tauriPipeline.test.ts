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

// F-20.1: `pipeline_list(project, iid)` and `pipeline_get(project, iid, id)` (docs/04 › IPC
// contract, plan M6). Both are read only. The answers are the core's PipelineTab list and
// PipelineHead in camelCase, handed on as they are.

describe('Tauri IPC client: pipelines (F-20.1)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('F-20.1 pipeline_list sends the project and the iid and returns the core tabs as they are', async () => {
    const tabs = [
      {
        id: 18342,
        number: 18342,
        sha: 'a3f9c12'.padEnd(40, '0'),
        version: 3,
        latest: true,
        status: 'passed',
      },
    ];
    invokeMock.mockResolvedValue(tabs);
    const client = createTauriClient();

    await expect(client.pipelineList('mobile/mobile-app', 482)).resolves.toEqual(tabs);

    expect(invokeMock.mock.calls).toEqual([
      ['pipeline_list', { project: 'mobile/mobile-app', iid: 482 }],
    ]);
  });

  it('F-20.1 pipeline_get sends the project, the iid and the pipeline id and returns the core head as it is', async () => {
    const head = {
      status: 'passed',
      allowedFailures: 1,
      number: 18342,
      kind: 'Merge request pipeline',
      sha: 'a3f9c12'.padEnd(40, '0'),
      version: 3,
      author: 'Marta K.',
      startedByMe: false,
      startedAt: '2026-10-19T10:01:00.000Z',
      durationSecs: 840,
    };
    invokeMock.mockResolvedValue(head);
    const client = createTauriClient();

    await expect(client.pipelineGet('mobile/mobile-app', 482, 18342)).resolves.toEqual(head);

    expect(invokeMock.mock.calls).toEqual([
      ['pipeline_get', { project: 'mobile/mobile-app', iid: 482, id: 18342 }],
    ]);
  });
});
