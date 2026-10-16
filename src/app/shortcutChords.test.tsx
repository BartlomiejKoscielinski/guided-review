import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGuideKeys } from '../screens/detailed/useGuideKeys';
import { layoutShortcut } from '../state/focus';
import {
  isAllShortcutsShortcut,
  isModeShortcut,
  isRiderShortcut,
  isSettingsShortcut,
  isSourceShortcut,
} from './keyboard';
import { isShortcutChord, SHORTCUTS, type ShortcutId } from './shortcuts';

// F-30.6: every key is read from the one table in shortcuts.ts, which F-19.7 edits. Each test
// remaps an entry and expects the screens' matchers to follow, so a hard-coded key fails here.

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

const saved = new Map<ShortcutId, readonly string[]>();

/** Gives a shortcut other keys for one test, as F-19.7 will. */
function remap(id: ShortcutId, keys: readonly string[]) {
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  if (!shortcut) throw new Error(`no shortcut ${id}`);
  if (!saved.has(id)) saved.set(id, shortcut.keys);
  (shortcut as { keys: readonly string[] }).keys = keys;
}

afterEach(() => {
  for (const [id, keys] of saved) {
    const shortcut = SHORTCUTS.find((s) => s.id === id);
    if (shortcut) (shortcut as { keys: readonly string[] }).keys = keys;
  }
  saved.clear();
});

describe('App and Code chords from the shortcuts table (F-30.6)', () => {
  it('F-30.6 Ctrl+K, Ctrl+D, Ctrl+, and Ctrl+Shift+O match with exactly their modifiers', () => {
    expect(isSourceShortcut(key({ key: 'k', ctrlKey: true }))).toBe(true);
    expect(isSourceShortcut(key({ key: 'K', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isModeShortcut(key({ key: 'd', ctrlKey: true }))).toBe(true);
    expect(isModeShortcut(key({ key: 'd' }))).toBe(false);
    expect(isSettingsShortcut(key({ key: ',', ctrlKey: true }))).toBe(true);
    expect(isRiderShortcut(key({ key: 'O', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isRiderShortcut(key({ key: 'o', ctrlKey: true }))).toBe(false);
    expect(layoutShortcut(key({ key: '2', ctrlKey: true }))).toBe('B');
    expect(isShortcutChord(key({ key: 'F12', shiftKey: true }), 'usages')).toBe(true);
    expect(isShortcutChord(key({ key: 'F12' }), 'usages')).toBe(false);
    expect(isShortcutChord(key({ key: 'F12' }), 'definition')).toBe(true);
  });

  it('F-30.6 AltGr (Ctrl+Alt on Polish keyboards) never sets off a Ctrl chord', () => {
    const altGr = { ctrlKey: true, altKey: true, modifierAltGraph: true };
    expect(isModeShortcut(key({ key: 'd', ...altGr }))).toBe(false);
    expect(isSourceShortcut(key({ key: 'k', ...altGr }))).toBe(false);
    expect(layoutShortcut(key({ key: '1', ...altGr }))).toBeNull();
  });

  it('F-30.6 ? matches as typed, with Shift or AltGr, but not with Ctrl or Alt alone', () => {
    expect(isAllShortcutsShortcut(key({ key: '?', shiftKey: true }))).toBe(true);
    expect(
      isAllShortcutsShortcut(
        key({ key: '?', ctrlKey: true, altKey: true, modifierAltGraph: true }),
      ),
    ).toBe(true);
    expect(isAllShortcutsShortcut(key({ key: '?', ctrlKey: true }))).toBe(false);
    expect(isAllShortcutsShortcut(key({ key: '/' }))).toBe(false);
  });

  it('F-30.6 the App and Code chords follow the table when it is edited', () => {
    remap('openAnything', ['Ctrl', 'J']);
    remap('mode', ['Ctrl', 'Shift', 'M']);
    remap('settings', ['Ctrl', '.']);
    remap('rider', ['Ctrl', 'Alt', 'R']);
    remap('guideLayout', ['Ctrl', '9']);
    remap('allShortcuts', ['/']);
    expect(isSourceShortcut(key({ key: 'k', ctrlKey: true }))).toBe(false);
    expect(isSourceShortcut(key({ key: 'j', ctrlKey: true }))).toBe(true);
    expect(isModeShortcut(key({ key: 'd', ctrlKey: true }))).toBe(false);
    expect(isModeShortcut(key({ key: 'M', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isSettingsShortcut(key({ key: ',', ctrlKey: true }))).toBe(false);
    expect(isSettingsShortcut(key({ key: '.', ctrlKey: true }))).toBe(true);
    expect(isRiderShortcut(key({ key: 'O', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isRiderShortcut(key({ key: 'r', ctrlKey: true, altKey: true }))).toBe(true);
    expect(layoutShortcut(key({ key: '3', ctrlKey: true }))).toBeNull();
    expect(layoutShortcut(key({ key: '9', ctrlKey: true }))).toBe('C');
    expect(isAllShortcutsShortcut(key({ key: '?', shiftKey: true }))).toBe(false);
    expect(isAllShortcutsShortcut(key({ key: '/' }))).toBe(true);
  });
});

describe('S-04 Guide aside keys from the shortcuts table (F-30.6)', () => {
  const press = (init: KeyboardEventInit) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, ...init }));
  };

  it('F-30.6 N and A on S-04 are the table’s Next note and Ask Claude, alone and not in a field', () => {
    const next = vi.fn();
    const ask = vi.fn();
    const { unmount } = renderHook(() => {
      useGuideKeys(next, ask);
    });
    press({ key: 'n' });
    press({ key: 'A' });
    press({ key: 'n', ctrlKey: true });
    expect(next).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('F-30.6 S-04’s N and A follow the table when it is edited', () => {
    remap('nextNote', ['M']);
    remap('ask', ['Q']);
    const next = vi.fn();
    const ask = vi.fn();
    const { unmount } = renderHook(() => {
      useGuideKeys(next, ask);
    });
    press({ key: 'n' });
    press({ key: 'a' });
    expect(next).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    press({ key: 'm' });
    press({ key: 'q' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledTimes(1);
    unmount();
  });
});
