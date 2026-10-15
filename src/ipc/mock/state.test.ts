import { describe, expect, it } from 'vitest';
import { createMockClient, type MockOptions } from '.';
import type { IpcClient } from '../client';
import { NOTES_STEP } from './fixtures/review';

// F-04.3: what S-03 keeps of a session (current step, layout, scroll per step, checklist ticks)
// and S-03 restored on start from stored data only (F-30.4). A new client on the same storage is
// the app started again.

type MockStorage = NonNullable<MockOptions['storage']>;

function memoryStorage(): MockStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

const start = (storage: MockStorage): IpcClient => createMockClient({ latencyMs: 0, storage });
const ignore = () => undefined;

async function openMr(ipc: IpcClient): Promise<string> {
  const { sessionId } = await ipc.sessionOpenMr(482, null, 'task', ignore);
  return sessionId;
}

describe('mock session state (F-04.3)', () => {
  it('F-04.3 current step, layout, scroll and ticks survive a restart, per session', async () => {
    const storage = memoryStorage();
    const before = start(storage);
    await before.appSettingsSet({ ui: { focusLayout: 'C' } });
    const session = await openMr(before);
    const other = await openMr(before);
    await before.appSettingsSet({ ui: { focusLayout: 'A' } });
    await before.sessionSetStep(session, 's4');
    await before.sessionSetLayout(session, 'B');
    await before.sessionSetScroll(session, 's4', 120);
    await before.sessionSetScroll(session, 's2', 300);
    await before.sessionSetScroll(session, 's4', 245);
    await before.sessionSetChecklist(session, 's4', ['Is the retry copy right?']);
    await before.sessionSetChecklist(session, 's5', ['Is the banner shown offline?']);
    await before.sessionSetChecklist(session, 's5', []);

    const after = start(storage);
    expect(await after.sessionState(session)).toEqual({
      currentStep: 's4',
      layout: 'B',
      // Opened in ui.startIn (Focus by default); the mode was never toggled.
      mode: 'focus',
      scroll: { s2: 300, s4: 245 },
      checklist: { s4: ['Is the retry copy right?'] },
    });
    // Opened in the layout of the setting at the time, nothing kept yet.
    expect(await after.sessionState(other)).toEqual({
      currentStep: null,
      layout: 'C',
      mode: 'focus',
      scroll: {},
      checklist: {},
    });
  });

  it('F-04.3 F-30.4 an opened MR session is restored on start', async () => {
    const storage = memoryStorage();
    const before = start(storage);
    const session = await openMr(before);
    await before.appSettingsSet({ ui: { lastRoute: { screen: 'S-03', sessionId: session } } });

    const after = start(storage);
    expect(await after.appStartRoute()).toEqual({ screen: 'S-03', sessionId: session });
    expect((await after.sessionMr(session))?.mr.iid).toBe(482);
    // A session opened after the restart gets an ID of its own.
    expect(await openMr(after)).not.toBe(session);
  });

  it('F-04.3 resume: the cached plan, the step S-03 was on without threads, its cached notes', async () => {
    const storage = memoryStorage();
    const before = start(storage);
    const session = await openMr(before);
    expect(await before.sessionResume(session)).toBeNull();
    await before.reviewPlan(session, ignore);
    await before.reviewFindings(session, NOTES_STEP, ignore);
    await before.reviewDecide(session, 'f1', { kind: 'dismiss' });
    await before.reviewMarkStep(session, 's1', true);
    await before.sessionSetStep(session, NOTES_STEP);

    const after = start(storage);
    const resumed = await after.sessionResume(session);
    if (!resumed) throw new Error('not resumed');
    expect(resumed.plan.cachedAt).toEqual(expect.any(String));
    expect(resumed.plan.reviewed).toEqual(['s1']);
    expect(resumed.step.step.id).toBe(NOTES_STEP);
    expect(resumed.step.number).toBe(4);
    expect(resumed.step.threads).toEqual([]);
    expect(resumed.findings?.findings.map((f) => [f.id, f.decision])).toEqual([
      ['f1', 'dismissed'],
      ['f2', 'open'],
      ['f3', 'open'],
      ['f4', 'open'],
    ]);

    // A step that was never analyzed comes without notes; no step task runs for it.
    await after.sessionSetStep(session, 's2');
    const unread = await start(storage).sessionResume(session);
    expect(unread?.step.step.id).toBe('s2');
    expect(unread?.findings).toBeNull();
  });
});

describe('mock session mode (F-08.1)', () => {
  it('F-08.1 the mode toggle is kept per session across a restart', async () => {
    const storage = memoryStorage();
    const before = start(storage);
    await before.appSettingsSet({ ui: { startIn: 'focus' } });
    const session = await openMr(before);
    const other = await openMr(before);
    expect((await before.sessionState(session)).mode).toBe('focus');
    await before.sessionSetMode(session, 'detailed');
    await before.sessionSetMode(other, 'detailed');
    // The last choice wins.
    await before.sessionSetMode(other, 'focus');

    const after = start(storage);
    expect((await after.sessionState(session)).mode).toBe('detailed');
    expect((await after.sessionState(other)).mode).toBe('focus');
  });

  it('F-08.1 the toggle leaves Start in; Start in is the mode of new sessions only', async () => {
    const storage = memoryStorage();
    const ipc = start(storage);
    await ipc.appSettingsSet({ ui: { startIn: 'focus' } });
    const session = await openMr(ipc);
    await ipc.sessionSetMode(session, 'detailed');
    expect((await ipc.appSettingsGet()).ui.startIn).toBe('focus');

    await ipc.appSettingsSet({ ui: { startIn: 'detailed' } });
    const later = await openMr(ipc);
    const focusOne = await openMr(ipc);
    await ipc.sessionSetMode(focusOne, 'focus');
    expect((await ipc.sessionState(later)).mode).toBe('detailed');
    expect((await ipc.sessionState(focusOne)).mode).toBe('focus');
    expect((await ipc.sessionState(session)).mode).toBe('detailed');
    expect((await ipc.appSettingsGet()).ui.startIn).toBe('detailed');
  });
});
