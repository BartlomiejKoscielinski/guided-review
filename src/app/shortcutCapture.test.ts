import { describe, expect, it } from 'vitest';
import { capturedKeys } from './shortcutCapture';
import { isShortcutChord, useShortcutStore } from './shortcuts';

// F-19.7: what a key pressed while Settings › Shortcuts waits for new keys becomes. The table's
// spelling (`↓`, `Space`, `Ctrl`), symbols as typed, Tab left to move focus (the capture ends on
// blur, so the keyboard is never trapped), and the captured keys match the same key afterwards.

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

describe('capturing new keys (F-19.7)', () => {
  it('F-19.7 Tab and Shift+Tab move focus on instead of becoming a shortcut; Ctrl+Tab can be one', () => {
    expect(capturedKeys(key({ key: 'Tab' }))).toEqual({ kind: 'pass' });
    expect(capturedKeys(key({ key: 'Tab', shiftKey: true }))).toEqual({ kind: 'pass' });
    expect(capturedKeys(key({ key: 'Tab', ctrlKey: true }))).toEqual({
      kind: 'keys',
      keys: ['Ctrl', 'Tab'],
    });
  });

  it('F-19.7 a modifier alone waits for the key; Esc with or without modifiers cancels', () => {
    for (const name of ['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Dead']) {
      expect(capturedKeys(key({ key: name }))).toEqual({ kind: 'ignore' });
    }
    expect(capturedKeys(key({ key: 'Escape' }))).toEqual({ kind: 'cancel' });
    expect(capturedKeys(key({ key: 'Escape', shiftKey: true }))).toEqual({ kind: 'cancel' });
  });

  it('F-19.7 named keys take the table spelling, arrows keep their modifiers, letters are upper case', () => {
    expect(capturedKeys(key({ key: 'ArrowDown', shiftKey: true }))).toEqual({
      kind: 'keys',
      keys: ['Shift', '↓'],
    });
    expect(capturedKeys(key({ key: ' ' }))).toEqual({ kind: 'keys', keys: ['Space'] });
    expect(capturedKeys(key({ key: 'ą', ctrlKey: true, altKey: true, metaKey: true }))).toEqual({
      kind: 'keys',
      keys: ['Ctrl', 'Alt', 'Win', 'Ą'],
    });
  });

  it('F-19.7 a symbol is taken as typed, without the Shift or AltGr the layout needs, and matches that way', () => {
    expect(capturedKeys(key({ key: '!', shiftKey: true }))).toEqual({ kind: 'keys', keys: ['!'] });
    const altGr = key({ key: '@', ctrlKey: true, altKey: true, modifierAltGraph: true });
    expect(capturedKeys(altGr)).toEqual({ kind: 'keys', keys: ['@'] });
    expect(capturedKeys(key({ key: ',', ctrlKey: true }))).toEqual({
      kind: 'keys',
      keys: ['Ctrl', ','],
    });

    useShortcutStore.setState({ changed: { allShortcuts: ['@'] } });
    try {
      expect(isShortcutChord(altGr, 'allShortcuts')).toBe(true);
      expect(isShortcutChord(key({ key: '@', ctrlKey: true }), 'allShortcuts')).toBe(false);
    } finally {
      useShortcutStore.setState({ changed: {} });
    }
  });

  it('F-19.7 only Ctrl alone with C, V, X, A or Z is refused as a text-editing chord', () => {
    expect(capturedKeys(key({ key: 'v', ctrlKey: true }))).toEqual({
      kind: 'refused',
      message: "Ctrl+V is a text-editing shortcut and can't be assigned.",
    });
    expect(capturedKeys(key({ key: 'v', ctrlKey: true, altKey: true }))).toEqual({
      kind: 'keys',
      keys: ['Ctrl', 'Alt', 'V'],
    });
    expect(capturedKeys(key({ key: 'b', ctrlKey: true }))).toEqual({
      kind: 'keys',
      keys: ['Ctrl', 'B'],
    });
  });
});
