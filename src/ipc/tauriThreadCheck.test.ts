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

// F-13.3: the thread check by its contract name (docs/plans/M5.md: `claude_thread_check(session,
// ch)`). The core takes the MR, the threads and the reviewed head from the session; the UI sends
// only the session and the channel for the task events, like `claude_summary_comment`.

/** A full commit id; the chip shows its first seven characters. */
const COMMIT = 'a91f2c0d4e8b5f36c17a09b2d3e4f5a6b7c8d9e0';

describe('Tauri IPC client: thread check (F-13.3)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
  });

  it('F-13.3 claude_thread_check sends the session and a channel that delivers the task events, and returns the hints', async () => {
    const answer = { hints: [{ discussionId: 'd-482-2', commit: COMMIT, hint: 'index added' }] };
    invokeMock.mockResolvedValue(answer);
    const client = createTauriClient();
    const events: unknown[] = [];
    const result = await client.claudeThreadCheck('mock-mr-session-1', (event) => {
      events.push(event);
    });
    expect(result).toEqual(answer);
    expect(invokeMock.mock.calls).toHaveLength(1);
    const [command, args] = invokeMock.mock.calls[0] ?? [];
    expect(command).toBe('claude_thread_check');
    const { session, ch, ...rest } = (args ?? {}) as {
      session?: unknown;
      ch?: { onmessage: (message: unknown) => void };
    };
    expect(session).toBe('mock-mr-session-1');
    expect(rest).toEqual({});
    ch?.onmessage({ kind: 'started' });
    expect(events).toEqual([{ kind: 'started' }]);
  });
});
