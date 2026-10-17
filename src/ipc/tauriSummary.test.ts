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

// F-12.4: the three summary commands by their contract names (docs/04 › IPC contract, plan M5).
// The core takes the MR, the plan and the drafts from the session; the UI sends only the session.

describe('Tauri IPC client: summary comment (F-12.4)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
  });

  it('F-12.4 claude_summary_comment sends the session and a channel that delivers the task events', async () => {
    invokeMock.mockResolvedValue({ summary: 'Thanks, the queue looks good.' });
    const client = createTauriClient();
    const events: unknown[] = [];
    const result = await client.claudeSummaryComment('mock-mr-session-1', (event) => {
      events.push(event);
    });
    expect(result).toEqual({ summary: 'Thanks, the queue looks good.' });
    expect(invokeMock.mock.calls).toHaveLength(1);
    const [command, args] = invokeMock.mock.calls[0] ?? [];
    expect(command).toBe('claude_summary_comment');
    const { session, ch, ...rest } = (args ?? {}) as {
      session?: unknown;
      ch?: { onmessage: (message: unknown) => void };
    };
    expect(session).toBe('mock-mr-session-1');
    expect(rest).toEqual({});
    ch?.onmessage({ kind: 'started' });
    expect(events).toEqual([{ kind: 'started' }]);
  });

  it('F-12.4 session_summary sends only the session', async () => {
    invokeMock.mockResolvedValue({ enabled: false, text: '', suggested: false });
    const client = createTauriClient();
    await expect(client.sessionSummary('mock-mr-session-1')).resolves.toEqual({
      enabled: false,
      text: '',
      suggested: false,
    });
    expect(invokeMock.mock.calls).toEqual([['session_summary', { session: 'mock-mr-session-1' }]]);
  });

  it('F-12.4 session_set_summary sends the session and the tick, text and suggested flag, nothing else', async () => {
    const client = createTauriClient();
    const summary = { enabled: true, text: 'Zażółć gęślą jaźń.\nSecond line.', suggested: true };
    await client.sessionSetSummary('mock-mr-session-1', summary);
    expect(invokeMock.mock.calls).toEqual([
      ['session_set_summary', { session: 'mock-mr-session-1', summary }],
    ]);
  });
});
