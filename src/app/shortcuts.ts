/** A shortcut hint: its keys and what they do ("J K hunk"). */
export interface ShortcutHint {
  keys: readonly string[];
  label: string;
}

/** The groups of Settings › Shortcuts, in screen order (F-19.3, M4 decision 3). */
export const SHORTCUT_GROUPS = ['Review', 'Code', 'App'] as const;

export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

/** One shortcut of F-30.6 with the label and keys of Settings.dc.html. */
export interface Shortcut extends ShortcutHint {
  group: ShortcutGroup;
}

/**
 * Every shortcut of F-30.6, once each, in the order Settings › Shortcuts lists them (F-19.3).
 * `Ctrl+1/2/3` are three shortcuts, as in the mock.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { group: 'Review', label: 'Next step', keys: [']'] },
  { group: 'Review', label: 'Previous step', keys: ['['] },
  { group: 'Review', label: 'Mark step reviewed', keys: ['Space'] },
  { group: 'Review', label: 'Next hunk', keys: ['J'] },
  { group: 'Review', label: 'Previous hunk', keys: ['K'] },
  { group: 'Review', label: 'Next note', keys: ['N'] },
  { group: 'Review', label: 'Add to drafts', keys: ['D'] },
  { group: 'Review', label: 'Dismiss note', keys: ['X'] },
  { group: 'Review', label: 'Comment on line', keys: ['C'] },
  { group: 'Review', label: 'Ask Claude', keys: ['A'] },
  { group: 'Review', label: 'Primary action (plan, re-review)', keys: ['Enter'] },
  { group: 'Code', label: 'Go to definition', keys: ['F12'] },
  { group: 'Code', label: 'Find usages', keys: ['Shift', 'F12'] },
  { group: 'Code', label: 'Open in Rider', keys: ['Ctrl', 'Shift', 'O'] },
  { group: 'App', label: 'Open anything', keys: ['Ctrl', 'K'] },
  { group: 'App', label: 'Settings', keys: ['Ctrl', ','] },
  { group: 'App', label: 'Switch Focus / Detailed', keys: ['Ctrl', 'D'] },
  { group: 'App', label: 'Sidebar layout', keys: ['Ctrl', '1'] },
  { group: 'App', label: 'Minimal layout', keys: ['Ctrl', '2'] },
  { group: 'App', label: 'Guide layout', keys: ['Ctrl', '3'] },
  { group: 'App', label: 'Close popover', keys: ['Esc'] },
  { group: 'App', label: 'All shortcuts', keys: ['?'] },
];

/** S-04's footer hints (F-08.8, Main.dc.html); `?` lists every shortcut (F-30.6). */
export const DETAILED_FOOTER_HINTS: readonly ShortcutHint[] = [
  { keys: ['J', 'K'], label: 'hunk' },
  { keys: ['[', ']'], label: 'step' },
  { keys: ['N'], label: 'note' },
  { keys: ['C'], label: 'comment' },
  { keys: ['A'], label: 'ask' },
  { keys: ['Space'], label: 'reviewed' },
  { keys: ['?'], label: 'all shortcuts' },
];
