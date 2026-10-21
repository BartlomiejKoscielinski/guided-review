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

// F-26.3: `fix_watch(file, ch)` by its contract name (docs/04 › fix, plan M7): the file of the
// thread and a channel that delivers the watch events (`{ kind: 'changed' }`). The command
// answers with the id of the watch; the function `fixWatch` resolves to ends it (**Stop waiting**,
// thread switch, leaving S-10) with `fix_watch_stop({ id })`.

describe('Tauri IPC client: fix_watch (F-26.3)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('F-26.3 fix_watch sends the file and a channel that delivers the changed event', async () => {
    invokeMock.mockResolvedValue('watch-7');
    const client = createTauriClient();
    const events: unknown[] = [];
    const file = 'src/Zażółć gęślą/Upload Queue.cs';
    const stop = await client.fixWatch(file, (e) => events.push(e));
    expect(typeof stop).toBe('function');
    expect(invokeMock.mock.calls).toHaveLength(1);
    const [command, args] = invokeMock.mock.calls[0] ?? [];
    expect(command).toBe('fix_watch');
    const {
      file: sent,
      ch,
      ...rest
    } = (args ?? {}) as { file?: unknown; ch?: { onmessage: (message: unknown) => void } };
    expect(sent).toBe(file);
    expect(rest).toEqual({});
    ch?.onmessage({ kind: 'changed' });
    expect(events).toEqual([{ kind: 'changed' }]);
  });

  it('F-26.3 the stop function ends the watch by the id fix_watch answered', async () => {
    invokeMock.mockResolvedValueOnce('watch-7').mockResolvedValue(undefined);
    const client = createTauriClient();
    const stop = await client.fixWatch('src/A.cs', () => undefined);

    stop();

    await vi.waitFor(() => {
      expect(invokeMock.mock.calls).toHaveLength(2);
    });
    expect(invokeMock.mock.calls[1]).toEqual(['fix_watch_stop', { id: 'watch-7' }]);
  });
});
