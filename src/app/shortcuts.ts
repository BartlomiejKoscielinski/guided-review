import { create } from 'zustand';

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
 * Every shortcut of F-30.6, once each, in the order Settings › Shortcuts lists them (F-19.3), with
 * its default keys; every key handler and hint reads them through `shortcutKeys`, which puts the
 * user's changes over them (F-19.7). `Ctrl+1/2/3` are three
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

/** The shortcut the user can't change: `Esc`, which every popover and the key capture rely on. */
export const FIXED_SHORTCUTS: ReadonlySet<ShortcutId> = new Set<ShortcutId>(['close']);

/** The keys the user gave an action in Settings › Shortcuts (F-19.7), by action. */
export type ChangedShortcutKeys = Partial<Record<ShortcutId, readonly string[]>>;

/** An action's keys in the table (its default). */
export function defaultKeys(id: ShortcutId): readonly string[] {
  return SHORTCUTS.find((shortcut) => shortcut.id === id)?.keys ?? [];
}

/** Two key lists name the same keys (`Ctrl`, `K`); letters in either case. */
export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, i) => key.toLowerCase() === b[i]?.toLowerCase());
}

const isShortcutId = (id: string): id is ShortcutId =>
  SHORTCUTS.some((shortcut) => shortcut.id === id);

const isKeyList = (keys: unknown): keys is readonly string[] =>
  Array.isArray(keys) &&
  keys.length > 0 &&
  keys.every((key) => typeof key === 'string' && key.trim() !== '');

/**
 * The changed shortcuts of the saved settings (`ui.shortcuts`) the app can use: an action it has,
 * other than `Esc`'s, with at least one key and other than its default. Anything else (an action
 * of another version, an entry without keys) is ignored, so its default keys stay.
 */
export function changedShortcutKeys(saved: unknown): ChangedShortcutKeys {
  const changed: ChangedShortcutKeys = {};
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return changed;
  for (const [id, keys] of Object.entries(saved as Record<string, unknown>)) {
    if (!isShortcutId(id) || FIXED_SHORTCUTS.has(id) || !isKeyList(keys)) continue;
    if (!sameKeys(keys, defaultKeys(id))) changed[id] = keys;
  }
  return changed;
}

interface ShortcutState {
  /** The changed shortcuts of the saved settings; the shell keeps them in step (F-19.7). */
  changed: ChangedShortcutKeys;
  setChanged: (changed: ChangedShortcutKeys) => void;
}

/** The changed shortcuts every key handler and hint reads (`useShortcutOverrides` fills it). */
export const useShortcutStore = create<ShortcutState>()((set) => ({
  changed: {},
  setChanged: (changed) => {
    set({ changed });
  },
}));

/** An action's keys now: the user's change (F-19.7) or the table's default. */
export function shortcutKeys(
  id: ShortcutId,
  changed: ChangedShortcutKeys = useShortcutStore.getState().changed,
): readonly string[] {
  return changed[id] ?? defaultKeys(id);
}

/** An action's keys now, for a hint that follows a change at once (F-19.7). */
export function useShortcutKeys(id: ShortcutId): readonly string[] {
  return useShortcutStore((state) => state.changed[id]) ?? defaultKeys(id);
}

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
 * A key of the table the layout types as a character that is neither a letter nor a digit (`?`,
 * `,`); the arrows are named keys, not typed ones.
 */
export const isSymbol = (key: string) =>
  key.length === 1 && !(key in EVENT_KEYS) && !/[\p{L}\p{N}]/u.test(key);

/**
 * The pressed key matches `keys`: Ctrl, Alt, Shift and Win held exactly as listed, so AltGr
 * (Ctrl+Alt on Polish keyboards) never sets off a Ctrl chord and a single key (`↓`, `N`) matches
 * only alone. A symbol alone (`?`) matches as typed: the Shift or AltGr the layout types it with
 * counts; Ctrl, Alt or Win alone don't. Letters match in either case.
 */
function matchesKeys(event: KeyboardEvent, keys: readonly string[]): boolean {
  const key = keys.at(-1);
  if (key === undefined || MODIFIERS.has(key)) return false;
  if (event.key.toLowerCase() !== (EVENT_KEYS[key] ?? key).toLowerCase()) return false;
  if (keys.length === 1 && isSymbol(key)) {
    const altGr = event.getModifierState('AltGraph');
    return !event.metaKey && (altGr || (!event.ctrlKey && !event.altKey));
  }
  return (
    event.ctrlKey === keys.includes('Ctrl') &&
    event.altKey === keys.includes('Alt') &&
    event.shiftKey === keys.includes('Shift') &&
    event.metaKey === keys.includes('Win')
  );
}

/**
 * A review key of the table (`↓`, `Space`, `N`) with its keys now (F-19.7): pressed alone, without
 * Ctrl, Alt (AltGr on Polish keyboards is Ctrl+Alt), Shift or Win; letters in either case. A
 * review action the user gave a chord (`Ctrl+Shift+M`) matches that chord exactly.
 */
export function isShortcutKey(event: KeyboardEvent, id: ShortcutId): boolean {
  return matchesKeys(event, shortcutKeys(id));
}

/**
 * A shortcut of the table with its modifiers (the App and Code groups: `Ctrl+K`, `Ctrl+Shift+O`,
 * `Shift+F12`) and its keys now (F-19.7), matched as `matchesKeys` describes: exact modifiers, a
 * symbol alone (`?`) as typed.
 */
export function isShortcutChord(event: KeyboardEvent, id: ShortcutId): boolean {
  return matchesKeys(event, shortcutKeys(id));
}

/** The keys of a title or an accessible name: `Ctrl+Shift+O`. */
export function keysText(keys: readonly string[]): string {
  return keys.join('+');
}

/** S-04's footer hints (F-08.8 after M4 decision 15 and F-07.10); `?` lists every shortcut (F-30.6). */
const DETAILED_FOOTER: readonly { ids: readonly ShortcutId[]; label: string }[] = [
  { ids: ['prevChange', 'nextChange'], label: 'change' },
  { ids: ['prevFile', 'nextFile'], label: 'file' },
  { ids: ['markFile'], label: 'file reviewed' },
  { ids: ['nextNote'], label: 'note' },
  { ids: ['comment'], label: 'comment' },
  { ids: ['ask'], label: 'ask' },
  { ids: ['allShortcuts'], label: 'all shortcuts' },
];

/** S-04's footer hints with the keys now (F-19.7): `↑ ↓ change`, `Space file reviewed`, … */
export function detailedFooterHints(changed: ChangedShortcutKeys): ShortcutHint[] {
  return DETAILED_FOOTER.map(({ ids, label }) => ({
    keys: ids.flatMap((id) => shortcutKeys(id, changed)),
    label,
  }));
}
