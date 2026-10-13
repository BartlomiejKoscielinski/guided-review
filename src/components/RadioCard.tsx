import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './RadioCard.module.css';

export interface RadioCardProps {
  name: string;
  checked: boolean;
  onSelect: () => void;
  label: ReactNode;
  /** Counts under the label, in mono. */
  meta?: ReactNode;
}

/** docs/03-design-system.md › RadioCard: a card with a radio; selected = green tint + ring. */
export function RadioCard({ name, checked, onSelect, label, meta }: RadioCardProps) {
  return (
    <label className={cx(styles.card, checked && styles.on)}>
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className={styles.radio}
      />
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {meta !== undefined && <span className={styles.meta}>{meta}</span>}
      </span>
    </label>
  );
}
