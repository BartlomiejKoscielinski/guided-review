import type { MouseEvent, ReactNode } from 'react';
import { cx } from '../components/cx';
import type { Line } from '../ipc/types/Line';
import styles from './DiffView.module.css';

export interface LineNumberProps {
  no: number | undefined;
  line: Line | undefined;
  /** Shift+click toggles this one line in the index (F-16.1). */
  onShiftClick?: () => void;
  /** A click selects the line, Shift+click extends the selection to it (F-10.1). */
  onPick?: (extend: boolean) => void;
  /** Gutter markers before the number: note squares, the thread icon (F-07.5). */
  marker?: ReactNode;
}

/** A gutter cell with a line number. */
export function LineNumber({ no, line, onShiftClick, onPick, marker }: LineNumberProps) {
  const pickable = onShiftClick !== undefined && line !== undefined && line.kind !== 'ctx';
  const selectable = onPick !== undefined && no !== undefined;
  const onClick = (event: MouseEvent) => {
    if (pickable && event.shiftKey) {
      event.preventDefault();
      onShiftClick();
      return;
    }
    // A note square or thread icon keeps its own action.
    if (!selectable || (event.target as Element).closest('[data-markers]')) return;
    onPick(event.shiftKey);
  };
  return (
    <span
      className={cx(
        styles.lineNo,
        (pickable || selectable) && styles.pickable,
        marker != null && styles.marked,
      )}
      onClick={pickable || selectable ? onClick : undefined}
      onMouseDown={
        pickable || selectable
          ? (e) => {
              // Shift+click must not start a text selection.
              if (e.shiftKey) e.preventDefault();
            }
          : undefined
      }
      data-line-no={no}
    >
      {marker != null && (
        <span className={styles.markers} data-markers="">
          {marker}
        </span>
      )}
      {no ?? ''}
    </span>
  );
}
