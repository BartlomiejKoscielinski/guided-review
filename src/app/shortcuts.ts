/** A shortcut hint: its keys and what they do ("J K hunk"). */
export interface ShortcutHint {
  keys: readonly string[];
  label: string;
}

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
