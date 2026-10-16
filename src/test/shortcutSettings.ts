import type { IpcClient } from '../ipc/client';
import {
  createMockClient,
  DEFAULT_SETTINGS,
  MOCK_SETTINGS_KEY,
  type MockOptions,
} from '../ipc/mock';
import type { Settings } from '../ipc/types/Settings';

// Helpers of the F-19.7 tests: settings with changed shortcuts (`ui.shortcuts`: action id → keys,
// only the changed ones), a mock backend that starts with them saved, and a read of what the mock
// has saved. The field is read through `unknown` so these helpers compile before and after the
// generated `UiSettings` type has it.

/** The changed shortcuts: action id (`nextNote`) → keys (`['M']`, `['Ctrl', 'J']`). */
export type ChangedShortcuts = Record<string, readonly string[]>;

/** Settings as the core would have saved them after the user changed `changed`. */
export function settingsWithShortcuts(changed: ChangedShortcuts): Settings {
  return { ...DEFAULT_SETTINGS, ui: { ...DEFAULT_SETTINGS.ui, shortcuts: changed } } as Settings;
}

/** `ui.shortcuts` of settings; `undefined` while the field does not exist. */
export function changedShortcuts(settings: Settings): unknown {
  return (settings.ui as unknown as { shortcuts?: unknown }).shortcuts;
}

type MockStorage = NonNullable<MockOptions['storage']>;

/** A storage that keeps what the mock writes, like the core's database does between runs. */
export function memoryStorage(saved?: Settings): MockStorage {
  const items = new Map<string, string>();
  if (saved) items.set(MOCK_SETTINGS_KEY, JSON.stringify(saved));
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** A mock backend without latency that starts with `changed` shortcuts saved. */
export function clientWithShortcuts(
  changed: ChangedShortcuts,
  storage: MockStorage = memoryStorage(settingsWithShortcuts(changed)),
): IpcClient {
  return createMockClient({ latencyMs: 0, storage });
}
