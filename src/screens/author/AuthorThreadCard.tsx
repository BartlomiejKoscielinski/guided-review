import type { ReactNode } from 'react';
import { Button } from '../../components/Button';
import type { BlockColor } from '../../components/colors';
import { SpinnerIcon } from '../../components/icons';
import { Square } from '../../components/Square';
import { Tag } from '../../components/Tag';
import { formatAge } from '../../format/age';
import type { AuthorThread } from '../../ipc/types/AuthorThread';
import { OTHER_CHANGES_TEXT } from './authorText';
import styles from './AuthorThreadCard.module.css';
import type { RiderFixPhase } from './useFixInRider';

export interface AuthorThreadCardProps {
  thread: AuthorThread;
  /** The avatar colour of each note, in order. */
  colors: BlockColor[];
  /** Fix in Rider: opens the thread's file at its line and waits for its change (F-26.3). */
  onFixInRider: () => void;
  /** Where Fix in Rider is; `waiting` and `changed` replace the actions. */
  riderPhase?: RiderFixPhase;
  /** The busy line while waiting: "Opened <name>:<line> in Rider. Waiting for your change…". */
  riderBusyText?: string;
  /** **Stop waiting**. */
  onStopWaiting?: () => void;
  /** Fix with Claude (F-25.1 on author threads); the flow is wired by its own criterion. */
  onFixWithClaude?: () => void;
  /** Reply on a change thread (F-26.5); its composer is wired by its own criterion. */
  onReply?: () => void;
  /** A question's answer (F-26.7): the reply composer, or "Answered…", in place of the actions. */
  answer?: ReactNode;
  /**
   * After Push and reply in this visit (F-26.6, Author.dc.html `fDone`): the actions and the Rider
   * lines go, my reply ends the conversation, and a resolved thread shows "Resolved".
   */
  pushed?: 'resolved' | 'replied';
  /** Read-only author mode (F-26.8): no Fix with Claude, no Fix in Rider; Reply stays. */
  readOnly?: boolean;
  /**
   * Other files of the checkout have uncommitted changes (M7 decision 10): a warning above the fix
   * actions that they won't be part of the commit (the commit takes only the thread's file).
   */
  otherChanges?: boolean;
}

/**
 * S-10's thread card (F-26.2, Author.dc.html): the conversation in order (avatar, author - my own
 * note reads "You" -, age, full text) and the actions. A change request on a file offers
 * **Fix with Claude**, **Fix in Rider** and **Reply**; a General change thread is answered, not
 * fixed, so it offers **Reply** only; a question holds its reply composer instead (`answer`,
 * F-26.7). While Fix in Rider waits for the file the actions give
 * way to the busy line and **Stop waiting**; a detected change shows "Change detected from Rider.
 * Commit it below." (F-26.3, Author.dc.html `fBusy`, `fApplied`). After the push the
 * conversation ends with my reply, and a resolved thread reads "Resolved" (F-26.6, `fDone`).
 */
export function AuthorThreadCard({
  thread,
  colors,
  onFixInRider,
  onFixWithClaude,
  onReply,
  answer,
  riderPhase = 'idle',
  riderBusyText = '',
  onStopWaiting,
  pushed,
  readOnly = false,
  otherChanges = false,
}: AuthorThreadCardProps) {
  const fixable = !readOnly && thread.kind === 'change' && thread.path !== null;
  const phase = pushed ? 'pushed' : riderPhase;
  const question = thread.kind === 'question' && answer !== undefined;
  return (
    <section aria-label="Thread" className={styles.card}>
      {thread.notes.map((note, i) => (
        <div key={`${String(i)}-${note.createdAt}`} className={styles.note}>
          <span className={styles.avatar} data-color={colors[i] ?? 'green'} aria-hidden="true">
            {note.avatar}
          </span>
          <div className={styles.noteBody}>
            <span className={styles.noteHead}>
              <span className={styles.author}>{note.mine ? 'You' : note.author}</span>
              <span className={styles.age}>{formatAge(note.createdAt)}</span>
            </span>
            <span className={styles.text}>{note.body}</span>
          </div>
        </div>
      ))}
      {phase === 'idle' && question && answer}
      {phase === 'idle' && fixable && otherChanges && (
        <p role="note" className={styles.otherChanges}>
          <Square color="orange" size={9} />
          <span>{OTHER_CHANGES_TEXT}</span>
        </p>
      )}
      {phase === 'idle' && !question && (
        <div className={styles.actions}>
          {fixable && (
            <>
              <button type="button" className={styles.primary} onClick={onFixWithClaude}>
                Fix with Claude
              </button>
              <button type="button" className={styles.neutral} onClick={onFixInRider}>
                Fix in Rider
              </button>
            </>
          )}
          <button type="button" className={styles.quiet} onClick={onReply}>
            Reply
          </button>
        </div>
      )}
      {phase === 'waiting' && (
        <div className={styles.busyRow}>
          <span role="status" className={styles.busy}>
            <SpinnerIcon className={styles.spinner} />
            {riderBusyText}
          </span>
          <Button variant="ghost" size={30} onClick={onStopWaiting}>
            Stop waiting
          </Button>
        </div>
      )}
      {phase === 'changed' && (
        <span role="status" className={styles.applied}>
          <span className={styles.appliedMark} />
          Change detected from Rider. Commit it below.
        </span>
      )}
      {pushed === 'resolved' && (
        <span className={styles.resolved}>
          <Tag color="green">Resolved</Tag>
        </span>
      )}
    </section>
  );
}
