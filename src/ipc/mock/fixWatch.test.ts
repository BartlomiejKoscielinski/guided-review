import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './index';

// F-26.3: the mock's `fixWatch(file, onEvent)` stands in for the core's `fix_watch`: it resolves
// at once with the function that ends the watch, and "Rider" changes the file about 2.2 s later
// (the design mock's timer in Author.dc.html, `fixRider`): one `{ kind: 'changed' }` event, then
// the watch is over. Stopping before that means no event.

describe('mock fixWatch (F-26.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('F-26.3 reports one changed event after about two seconds, then nothing more', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    const events: unknown[] = [];

    const stop = await ipc.fixWatch('src/App/Workers/UploadWorker.cs', (e) => events.push(e));
    expect(typeof stop).toBe('function');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual([]);

    await vi.advanceTimersByTimeAsync(1500);
    expect(events).toEqual([{ kind: 'changed' }]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(events).toEqual([{ kind: 'changed' }]);
  });

  it('F-26.3 stopping before the change means no event', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    const events: unknown[] = [];

    const stop = await ipc.fixWatch('src/App/Workers/UploadWorker.cs', (e) => events.push(e));
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(events).toEqual([]);
  });
});
