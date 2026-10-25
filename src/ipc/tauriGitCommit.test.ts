import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createTauriClient } from './tauri';

// F-26.4: `git_commit` gains `fixup` (the full SHA of the commit this one fixes, or null) and
// `only` (the files that go into the commit, or null for what is staged): src/ipc/tauri.ts
// sends them next to `message` and `amend`.

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (message: unknown) => void = () => undefined;
  },
}));
const invokeMock = vi.mocked(invoke);

const SHA = 'b71e3a0c4d5e6f708192a3b4c5d6e7f8091a2b3c';

describe('Tauri IPC client git_commit (F-26.4)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ sha: SHA, shortSha: 'b71e3a0' });
  });

  it('F-26.4 sends the fixup target and the file list', async () => {
    await createTauriClient().gitCommit('Fix', false, SHA, ['src/App ż/Upload Worker.cs']);

    expect(invokeMock.mock.calls).toEqual([
      [
        'git_commit',
        { message: 'Fix', amend: false, fixup: SHA, only: ['src/App ż/Upload Worker.cs'] },
      ],
    ]);
  });

  it('F-26.4 a commit without a fixup sends null for it', async () => {
    await createTauriClient().gitCommit('Fix', false, undefined, ['a.cs']);

    expect(invokeMock.mock.calls).toEqual([
      ['git_commit', { message: 'Fix', amend: false, fixup: null, only: ['a.cs'] }],
    ]);
  });
});
