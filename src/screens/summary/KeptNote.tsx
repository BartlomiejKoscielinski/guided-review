import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import type { Draft } from '../../ipc/types/Draft';
import { FixCard } from '../fix/FixCard';
import { FINISH_FIRST, useFix } from '../fix/useFix';
import { SEVERITY_TAG } from '../step/noteCopy';
import { draftLocation } from './checklist';
import styles from './Summary.module.css';

export interface KeptNoteProps {
  draft: Draft;
}

/**
 * A note kept to fix: S-05's draft row without the checkbox and the edit button (F-17.4). A note
 * on a file offers Fix with Claude (F-25.1); a comment on the whole change has no file to fix. The
 * fix card opens under the note (F-25.3, M7 decision 1), one fix at a time (M7 decision 4).
 */
export function KeptNote({ draft }: KeptNoteProps) {
  const tag = draft.severity ? SEVERITY_TAG[draft.severity] : null;
  const location = draftLocation(draft);
  const fixable = draft.position !== null;
  const fix = useFix(draft.sessionId, { draftId: draft.id }, draft.position?.file ?? '');
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
          disabled={fix.blocked}
          title={fix.blocked ? FINISH_FIRST : undefined}
          onClick={fix.start}
        >
          Fix with Claude
        </Button>
      )}
      {fix.state && (
        <div className={styles.fixCard}>
          <FixCard
            state={fix.state}
            onAccept={fix.accept}
            onDiscard={fix.discard}
            onCancel={fix.cancel}
            onClose={fix.close}
          />
        </div>
      )}
    </li>
  );
}
