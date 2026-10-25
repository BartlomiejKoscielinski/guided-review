import { Link } from 'react-router';
import type { BlockColor } from './colors';
import { Square } from './Square';
import styles from './Chip.module.css';

export interface StatusChipProps {
  color: BlockColor;
  /** The status in words ("Pipeline passed"); the square alone never carries it. */
  label: string;
  /** Tooltip, e.g. the problem behind a failing check. */
  title?: string;
  onOpen?: () => void;
  /** Makes the chip a link to this path (S-10's pipeline chip opens S-08, F-20.10). */
  to?: string;
}

/** Chip with a status square and text, e.g. the pipeline status in author mode (S-10). */
export function StatusChip({ color, label, title, onOpen, to }: StatusChipProps) {
  const content = (
    <>
      <Square color={color} />
      {label}
    </>
  );
  if (to !== undefined) {
    return (
      <Link className={styles.chip} title={title} to={to}>
        {content}
      </Link>
    );
  }
  if (!onOpen) {
    return (
      <span className={styles.chip} title={title}>
        {content}
      </span>
    );
  }
  return (
    <button type="button" className={styles.chip} title={title} onClick={onOpen}>
      {content}
    </button>
  );
}
