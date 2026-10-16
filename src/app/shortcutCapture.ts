import { isSymbol } from './shortcuts';

/** What a key pressed while Settings › Shortcuts waits for new keys means (F-19.7). */
export type CapturedKeys =
  /** Tab: focus moves on as usual, which ends the capture (no keyboard trap). */
  | { kind: 'pass' }
  /** A modifier alone (Ctrl, Shift, …) or a key that names nothing: still waiting. */
  | { kind: 'ignore' }
  /** Esc: the capture ends and nothing changes. */
  | { kind: 'cancel' }
  /** A key that can't be a shortcut, with the reason. */
  | { kind: 'refused'; message: string }
  /** The new keys, in the table's spelling (`Ctrl`, `Shift`, `M`). */
  | { kind: 'keys'; keys: string[] };

/** `KeyboardEvent.key` values the table spells differently (the inverse of its EVENT_KEYS). */
const TABLE_NAMES: Readonly<Record<string, string>> = {
  ArrowDown: '↓',
  ArrowUp: '↑',
  ArrowRight: '→',
  ArrowLeft: '←',
  ' ': 'Space',
};

/** Keys that are pressed on the way to a key or name none. */
const NOT_A_KEY = new Set([
  'Control',
  'Shift',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'Fn',
  'FnLock',
  'Hyper',
  'Super',
  'Symbol',
  'SymbolLock',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Dead',
  'Process',
  'Unidentified',
]);

/** Ctrl with these letters copies, pastes, cuts, selects all and undoes in text fields. */
const TEXT_EDITING = new Set(['C', 'V', 'X', 'A', 'Z']);

/**
 * The keys a keydown names while a shortcut is being changed (F-19.7, M4 decision 16). Letters
 * are upper case; Ctrl, Alt, Shift and Win come first in that order. A symbol (`?`, `,`) is taken
 * as typed, without the Shift or AltGr the layout needs for it, as the shortcuts match it.
 * `Esc` cancels and `Ctrl+C/V/X/A/Z` are refused, so text fields keep them.
 */
export function capturedKeys(event: KeyboardEvent): CapturedKeys {
  if (event.key === 'Escape') return { kind: 'cancel' };
  if (NOT_A_KEY.has(event.key) || event.key === '') return { kind: 'ignore' };
  if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
    return { kind: 'pass' };
  }
  const key =
    TABLE_NAMES[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  const altGr = event.getModifierState('AltGraph');
  if (isSymbol(key) && !event.metaKey && (altGr || (!event.ctrlKey && !event.altKey))) {
    return { kind: 'keys', keys: [key] };
  }
  const keys = [
    ...(event.ctrlKey ? ['Ctrl'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
    ...(event.metaKey ? ['Win'] : []),
    key,
  ];
  if (keys.length === 2 && keys[0] === 'Ctrl' && TEXT_EDITING.has(key)) {
    return {
      kind: 'refused',
      message: `Ctrl+${key} is a text-editing shortcut and can't be assigned.`,
    };
  }
  return { kind: 'keys', keys };
}
