import type { ReactNode } from 'react';
import { useDrafts } from '../../ipc/hooks/useDrafts';
import { DraftRow } from './DraftRow';
import styles from './Summary.module.css';

export interface DraftsTabProps {
  sessionId: string;
  /** A Publish runs: every row waits (F-12.5). */
  locked?: boolean;
  /** The Publish banners (F-12.5), between the note and the rows as in the mock. */
  children?: ReactNode;
}

/**
 * The Drafts tab of S-05 of an MR session (F-12.3, SummaryDesk.dc.html): "Only you can see drafts
 * until you publish them." ("Published to GitLab." once every draft is), then one row per draft
 * in the order they were made. The drafts are read from this PC; no GitLab command runs here.
 */
export function DraftsTab({ sessionId, locked = false, children }: DraftsTabProps) {
  const drafts = useDrafts(sessionId);

  if (!drafts.data) {
    return drafts.error ? (
      <p role="alert" className={styles.draftError}>
        {drafts.error.message}
      </p>
    ) : null;
  }
  if (drafts.data.length === 0) return <p className={styles.empty}>No drafts yet.</p>;

  const allPublished = drafts.data.every((d) => d.publishedNoteId !== null);
  return (
    <>
      <p className={styles.commentsSub}>
        {allPublished ? 'Published to GitLab.' : 'Only you can see drafts until you publish them.'}
      </p>
      {children}
      <ul className={styles.notes}>
        {drafts.data.map((draft, index) => (
          <DraftRow key={draft.id} draft={draft} n={index + 1} locked={locked} />
        ))}
      </ul>
    </>
  );
}
