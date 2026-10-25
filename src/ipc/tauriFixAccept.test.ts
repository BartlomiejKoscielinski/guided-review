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

// F-25.4: `fix_accept(id)` and `fix_discard(id)` by their contract names (docs/04 › fix, plan
// M7): the proposal's id, no other argument; both answer with nothing.

describe('Tauri IPC client: fix_accept and fix_discard (F-25.4)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('F-25.4 fix_accept sends the proposal id', async () => {
    invokeMock.mockResolvedValue(undefined);
    await createTauriClient().fixAccept('fix-1');
    expect(invokeMock.mock.calls).toEqual([['fix_accept', { id: 'fix-1' }]]);
  });

  it('F-25.4 fix_discard sends the proposal id', async () => {
    invokeMock.mockResolvedValue(undefined);
    await createTauriClient().fixDiscard('fix-1');
    expect(invokeMock.mock.calls).toEqual([['fix_discard', { id: 'fix-1' }]]);
  });

  it('F-25.4 a refused fix_accept rejects with the core error code and message', async () => {
    invokeMock.mockRejectedValue({
      code: 'FIX_STALE',
      message: 'The file changed while Claude worked. Run it again.',
      retryable: false,
    });
    await expect(createTauriClient().fixAccept('fix-1')).rejects.toMatchObject({
      code: 'FIX_STALE',
      message: 'The file changed while Claude worked. Run it again.',
    });
  });
});
