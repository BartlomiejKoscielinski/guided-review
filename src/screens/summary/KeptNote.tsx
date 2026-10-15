import { cx } from '../../components/cx';
import type { Draft } from '../../ipc/types/Draft';
import { SEVERITY_TAG } from '../step/noteCopy';
import { draftLocation } from './checklist';
import styles from './Summary.module.css';

export interface KeptNoteProps {
  draft: Draft;
}

/** A note kept to fix: S-05's draft row without the checkbox and the edit button (F-17.4). */
export function KeptNote({ draft }: KeptNoteProps) {
  const tag = draft.severity ? SEVERITY_TAG[draft.severity] : null;
  const location = draftLocation(draft);
  return (
    <li className={styles.row}>
      <span className={cx(styles.dot, tag ? styles[tag.color] : styles.plain)}>
        {tag && <span className="visually-hidden">{tag.label}</span>}
      </span>
      <div className={styles.noteText}>
        <p className={styles.note}>{draft.body}</p>
        {location && <span className={styles.location}>{location}</span>}
      </div>
    </li>
  );
}
