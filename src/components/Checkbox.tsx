import type { ReactNode } from 'react';
import { CheckIcon, MixedIcon } from './icons';
import { cx } from './cx';
import styles from './Checkbox.module.css';

export type CheckState = 'on' | 'off' | 'mixed';

export interface CheckboxProps {
  state: CheckState;
  /** Accessible name ("Include DeliveryPhotoPage.xaml"); the visible text when `children` is set. */
  label: string;
  onToggle: () => void;
  /** Green for staging (S-06), blue for drafts to publish (S-05). */
  tone?: 'green' | 'blue';
  disabled?: boolean;
  /** Visible text next to the box, part of the same control ("In commit"). */
  children?: ReactNode;
  className?: string;
}

/**
 * Square tri-state checkbox (docs/03 › Checkbox): filled with a black check when on, a dash
 * when mixed, an empty ring when off.
 */
export function Checkbox({
  state,
  label,
  onToggle,
  tone = 'green',
  disabled,
  children,
  className,
}: CheckboxProps) {
  const box = (
    <span className={cx(styles.box, styles[tone], styles[state])} aria-hidden="true">
      {state === 'on' && <CheckIcon size={10} strokeWidth={3.2} />}
      {state === 'mixed' && <MixedIcon />}
    </span>
  );
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'mixed' ? 'mixed' : state === 'on'}
      aria-label={label}
      disabled={disabled}
      className={cx(styles.control, styles[tone], className)}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {box}
      {children}
    </button>
  );
}
