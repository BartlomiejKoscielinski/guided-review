import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import type { Draft } from '../../ipc/types/Draft';
import { SEVERITY_TAG } from '../step/noteCopy';
import { draftLocation } from './checklist';
import styles from './Summary.module.css';

export interface KeptNoteProps {
  draft: Draft;
  /** Fix with Claude on this note (F-25.1, M7 decision 1); the fix card is F-25.2. */
  onFix?: (draft: Draft) => void;
}

/**
 * A note kept to fix: S-05's draft row without the checkbox and the edit button (F-17.4). A note
 * on a file offers Fix with Claude (F-25.1); a comment on the whole change has no file to fix.
 */
export function KeptNote({ draft, onFix }: KeptNoteProps) {
  const tag = draft.severity ? SEVERITY_TAG[draft.severity] : null;
  const location = draftLocation(draft);
  const fixable = draft.position !== null;
  return (
    <li className={cx(styles.row, fixable && styles.rowFix)}>
      <span className={cx(styles.dot, tag ? styles[tag.color] : styles.plain)}>
        {tag && <span className="visually-hidden">{tag.label}</span>}
      </span>
      <div className={styles.noteText}>
        <p className={styles.note}>{draft.body}</p>
        {location && <span className={styles.location}>{location}</span>}
      </div>
      {fixable && (
        <Button
          variant="claude"
          size={30}
          onClick={() => {
            onFix?.(draft);
          }}
        >
          Fix with Claude
        </Button>
      )}
    </li>
  );
}
