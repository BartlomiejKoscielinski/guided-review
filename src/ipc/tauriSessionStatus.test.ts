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

describe('Tauri IPC client: session status (F-12.7)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('F-12.7 session_status sends the session and returns its status', async () => {
    invokeMock.mockResolvedValue('draftsOnly');

    await expect(createTauriClient().sessionStatus('drafts-only-1')).resolves.toBe('draftsOnly');

    expect(invokeMock).toHaveBeenCalledWith('session_status', { sessionId: 'drafts-only-1' });
  });
});
