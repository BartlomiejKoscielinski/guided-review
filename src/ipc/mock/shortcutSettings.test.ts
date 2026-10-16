import { describe, expect, it } from 'vitest';
import { changedShortcuts, memoryStorage } from '../../test/shortcutSettings';
import { applySettingsPatch, type SettingsPatch } from '../settings-patch';
import { createMockClient, DEFAULT_SETTINGS } from './index';

// F-19.7 in the mock backend (ADR-016): `ui.shortcuts` (action id → keys, only the changed ones)
// behaves as the core's settings do (src-tauri `f19_7_*` tests): none changed by default, saved at
// once, kept between runs, and a patch replaces the whole map, so a Reset drops a key from it.

// The generated `UiSettings` type has no `shortcuts` field until F-19.7 adds it.
const patch = (shortcuts: Record<string, string[]>) =>
  ({ ui: { shortcuts } }) as unknown as SettingsPatch;

describe('mock settings › shortcuts', () => {
  it('F-19.7 no shortcut is changed by default', async () => {
    expect(changedShortcuts(DEFAULT_SETTINGS)).toEqual({});
    const client = createMockClient({ latencyMs: 0 });
    expect(changedShortcuts(await client.appSettingsGet())).toEqual({});
  });

  it('F-19.7 a patch with changed shortcuts is saved and kept for the next run', async () => {
    const storage = memoryStorage();
    const first = createMockClient({ latencyMs: 0, storage });
    const saved = await first.appSettingsSet(
      patch({ nextNote: ['M'], openAnything: ['Ctrl', 'J'] }),
    );
    expect(changedShortcuts(saved)).toEqual({ nextNote: ['M'], openAnything: ['Ctrl', 'J'] });

    const second = createMockClient({ latencyMs: 0, storage });
    expect(changedShortcuts(await second.appSettingsGet())).toEqual({
      nextNote: ['M'],
      openAnything: ['Ctrl', 'J'],
    });
  });

  it('F-19.7 a later patch replaces the changed shortcuts whole, so a Reset drops its key', () => {
    const one = applySettingsPatch(DEFAULT_SETTINGS, patch({ nextNote: ['M'], ask: ['Q'] }));
    const two = applySettingsPatch(one, patch({ ask: ['Q'] }));
    expect(changedShortcuts(two)).toEqual({ ask: ['Q'] });
    expect(changedShortcuts(applySettingsPatch(two, patch({})))).toEqual({});
  });

  it('F-19.7 changing another setting keeps the changed shortcuts', () => {
    const one = applySettingsPatch(DEFAULT_SETTINGS, patch({ nextNote: ['M'] }));
    const two = applySettingsPatch(one, { ui: { startIn: 'detailed' } });
    expect(two.ui.startIn).toBe('detailed');
    expect(changedShortcuts(two)).toEqual({ nextNote: ['M'] });
  });
});
