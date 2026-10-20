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

// F-25.3: `fix_propose(target, ch)` by its contract name (docs/04 › fix, plan M7): the target of
// the fix and a channel that delivers the task events; the answer is the FixProposal.

describe('Tauri IPC client: fix_propose (F-25.3)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('F-25.3 fix_propose sends the target and a channel that delivers the task events', async () => {
    const proposal = {
      id: 'fix-1',
      file: 'src/Zażółć gęślą/Upload Queue.cs',
      hunks: [],
      explanation: 'Done.',
    };
    invokeMock.mockResolvedValue(proposal);
    const client = createTauriClient();
    const target = { task: 'fix-1', sessionId: 'mock-mr-session-1', findingId: 'f2' };
    const events: unknown[] = [];
    await expect(client.fixPropose(target, (e) => events.push(e))).resolves.toEqual(proposal);
    expect(invokeMock.mock.calls).toHaveLength(1);
    const [command, args] = invokeMock.mock.calls[0] ?? [];
    expect(command).toBe('fix_propose');
    const {
      target: sent,
      ch,
      ...rest
    } = (args ?? {}) as {
      target?: unknown;
      ch?: { onmessage: (message: unknown) => void };
    };
    expect(sent).toEqual(target);
    expect(rest).toEqual({});
    ch?.onmessage({ kind: 'started' });
    expect(events).toEqual([{ kind: 'started' }]);
  });
});
