import { keysText, useShortcutKeys } from '../app/shortcuts';
import { Square } from './Square';
import styles from './Chip.module.css';

export interface ModelChipProps {
  /** "Sonnet 5.5 · medium", or "Claude Code signed in" on S-01 (F-01.6). */
  label: string;
  /** Opens Settings › Claude. */
  onOpen: () => void;
}

/** Purple-square chip in the title bar with the Claude model and effort of the screen's task. */
export function ModelChip({ label, onOpen }: ModelChipProps) {
  const settingsKeys = keysText(useShortcutKeys('settings'));
  return (
    <button
      type="button"
      className={styles.chip}
      title={`Claude model and effort · ${settingsKeys}`}
      onClick={onOpen}
    >
      <Square color="purple" />
      {label}
    </button>
  );
}
