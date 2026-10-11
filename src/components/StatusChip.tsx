import type { BlockColor } from './colors';
import { Square } from './Square';
import styles from './Chip.module.css';

export interface StatusChipProps {
  color: BlockColor;
  /** The status in words ("Pipeline passed"); the square alone never carries it. */
  label: string;
  onOpen?: () => void;
}

/** Chip with a status square and text, e.g. the pipeline status in author mode (S-10). */
export function StatusChip({ color, label, onOpen }: StatusChipProps) {
  const content = (
    <>
      <Square color={color} />
      {label}
    </>
  );
  if (!onOpen) return <span className={styles.chip}>{content}</span>;
  return (
    <button type="button" className={styles.chip} onClick={onOpen}>
      {content}
    </button>
  );
}
