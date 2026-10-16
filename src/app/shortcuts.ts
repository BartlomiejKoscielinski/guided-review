/** A shortcut hint: its keys and what they do ("↑ ↓ change"). */
export interface ShortcutHint {
  keys: readonly string[];
  label: string;
}

/** The groups of Settings › Shortcuts, in screen order (F-19.3, M4 decision 3). */
export const SHORTCUT_GROUPS = ['Review', 'Code', 'App'] as const;

export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

/** What a shortcut does; the review screens look their keys up by it (F-30.6). */
export type ShortcutId =
  | 'nextChange'
  | 'prevChange'
  | 'nextFile'
  | 'prevFile'
  | 'markFile'
  | 'nextNote'
  | 'addToDrafts'
  | 'dismissNote'
  | 'comment'
  | 'ask'
  | 'primary'
  | 'definition'
  | 'usages'
  | 'rider'
  | 'openAnything'
  | 'settings'
  | 'mode'
  | 'sidebarLayout'
  | 'minimalLayout'
  | 'guideLayout'
  | 'close'
  | 'allShortcuts';

/** One shortcut of F-30.6 with the label and keys of Settings.dc.html. */
export interface Shortcut extends ShortcutHint {
  id: ShortcutId;
  group: ShortcutGroup;
}

/**
 * Every shortcut of F-30.6, once each, in the order Settings › Shortcuts lists them (F-19.3), and
 * the one place the review keys are read from (F-19.7 edits it). `Ctrl+1/2/3` are three
 * shortcuts, as in the mock. The review group is the owner's keymap (M4 decision 15).
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'nextChange', group: 'Review', label: 'Next change', keys: ['↓'] },
  { id: 'prevChange', group: 'Review', label: 'Previous change', keys: ['↑'] },
  { id: 'nextFile', group: 'Review', label: 'Next file', keys: ['→'] },
  { id: 'prevFile', group: 'Review', label: 'Previous file', keys: ['←'] },
  { id: 'markFile', group: 'Review', label: 'Mark file reviewed', keys: ['Space'] },
  { id: 'nextNote', group: 'Review', label: 'Next note', keys: ['N'] },
  { id: 'addToDrafts', group: 'Review', label: 'Add to drafts', keys: ['D'] },
  { id: 'dismissNote', group: 'Review', label: 'Dismiss note', keys: ['X'] },
  { id: 'comment', group: 'Review', label: 'Comment on line', keys: ['C'] },
  { id: 'ask', group: 'Review', label: 'Ask Claude', keys: ['A'] },
  { id: 'primary', group: 'Review', label: 'Primary action (plan, re-review)', keys: ['Enter'] },
  { id: 'definition', group: 'Code', label: 'Go to definition', keys: ['F12'] },
  { id: 'usages', group: 'Code', label: 'Find usages', keys: ['Shift', 'F12'] },
  { id: 'rider', group: 'Code', label: 'Open in Rider', keys: ['Ctrl', 'Shift', 'O'] },
  { id: 'openAnything', group: 'App', label: 'Open anything', keys: ['Ctrl', 'K'] },
  { id: 'settings', group: 'App', label: 'Settings', keys: ['Ctrl', ','] },
  { id: 'mode', group: 'App', label: 'Switch Focus / Detailed', keys: ['Ctrl', 'D'] },
  { id: 'sidebarLayout', group: 'App', label: 'Sidebar layout', keys: ['Ctrl', '1'] },
  { id: 'minimalLayout', group: 'App', label: 'Minimal layout', keys: ['Ctrl', '2'] },
  { id: 'guideLayout', group: 'App', label: 'Guide layout', keys: ['Ctrl', '3'] },
  { id: 'close', group: 'App', label: 'Close popover', keys: ['Esc'] },
  { id: 'allShortcuts', group: 'App', label: 'All shortcuts', keys: ['?'] },
];

/** The table's names of keys that `KeyboardEvent.key` spells differently. */
const EVENT_KEYS: Readonly<Record<string, string>> = {
  '↓': 'ArrowDown',
  '↑': 'ArrowUp',
  '→': 'ArrowRight',
  '←': 'ArrowLeft',
  Space: ' ',
  Esc: 'Escape',
};

const MODIFIERS = new Set(['Ctrl', 'Alt', 'Shift', 'Win']);

/**
 * A single-key shortcut of the table (`↓`, `Space`, `N`) pressed alone: without Ctrl, Alt (AltGr
 * on Polish keyboards is Ctrl+Alt), Shift or Win. Letters match in either case. A chord or an
 * unknown id never matches here.
 */
export function isShortcutKey(event: KeyboardEvent, id: ShortcutId): boolean {
  if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return false;
  const keys = SHORTCUTS.find((shortcut) => shortcut.id === id)?.keys ?? [];
  const [key] = keys;
  if (keys.length !== 1 || key === undefined || MODIFIERS.has(key)) return false;
  return event.key.toLowerCase() === (EVENT_KEYS[key] ?? key).toLowerCase();
}

/** S-04's footer hints (F-08.8 after M4 decision 15 and F-07.10); `?` lists every shortcut (F-30.6). */
export const DETAILED_FOOTER_HINTS: readonly ShortcutHint[] = [
  { keys: ['↑', '↓'], label: 'change' },
  { keys: ['←', '→'], label: 'file' },
  { keys: ['Space'], label: 'file reviewed' },
  { keys: ['N'], label: 'note' },
  { keys: ['C'], label: 'comment' },
  { keys: ['A'], label: 'ask' },
  { keys: ['?'], label: 'all shortcuts' },
];
