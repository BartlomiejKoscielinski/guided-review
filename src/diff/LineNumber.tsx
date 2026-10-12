import type { MouseEvent } from 'react';
import { cx } from '../components/cx';
import type { Line } from '../ipc/types/Line';
import styles from './DiffView.module.css';

export interface LineNumberProps {
  no: number | undefined;
  line: Line | undefined;
  /** Shift+click toggles this one line in the index (F-16.1). */
  onShiftClick?: () => void;
}

/** A gutter cell with a line number. */
export function LineNumber({ no, line, onShiftClick }: LineNumberProps) {
  const pickable = onShiftClick !== undefined && line !== undefined && line.kind !== 'ctx';
  const onClick = (event: MouseEvent) => {
    if (pickable && event.shiftKey) {
      event.preventDefault();
      onShiftClick();
    }
  };
  return (
    <span
      className={cx(styles.lineNo, pickable && styles.pickable)}
      onClick={pickable ? onClick : undefined}
      onMouseDown={
        pickable
          ? (e) => {
              // Shift+click must not start a text selection.
              if (e.shiftKey) e.preventDefault();
            }
          : undefined
      }
      data-line-no={no}
    >
      {no ?? ''}
    </span>
  );
}
