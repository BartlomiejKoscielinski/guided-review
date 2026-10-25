import { useEffect, useRef } from 'react';
import styles from './CreateMr.module.css';

export interface ReplaceEditsConfirmProps {
  onReplace: () => void;
  onCancel: () => void;
}

/**
 * "Replace your edits?" before Claude's text replaces a title or description the user changed
 * (F-27.2, M7 decision 16). Like the Run pipeline strip of S-08 it opens with the focus on Cancel
 * (keeping the typed text is the safe answer) and Escape cancels like Cancel.
 */
export function ReplaceEditsConfirm({ onReplace, onCancel }: ReplaceEditsConfirmProps) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-label="Replace your edits?"
      className={styles.confirm}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <span className={styles.question}>Replace your edits?</span>
      <span className={styles.confirmButtons}>
        <button type="button" className={styles.replace} onClick={onReplace}>
          Replace
        </button>
        <button ref={cancel} type="button" className={styles.cancel} onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  );
}
