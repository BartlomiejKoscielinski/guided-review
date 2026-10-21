import { Button } from '../../components/Button';
import type { BlockColor } from '../../components/colors';
import { SpinnerIcon } from '../../components/icons';
import { formatAge } from '../../format/age';
import type { AuthorThread } from '../../ipc/types/AuthorThread';
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
  /** Reply (F-26.5, F-26.7); the composer is wired by its own criterion. */
  onReply?: () => void;
}

/**
 * S-10's thread card (F-26.2, Author.dc.html): the conversation in order (avatar, author - my own
 * note reads "You" -, age, full text) and the actions. A change request on a file offers
 * **Fix with Claude**, **Fix in Rider** and **Reply**; a question or a General thread is answered,
 * not fixed, so it offers **Reply** only. While Fix in Rider waits for the file the actions give
 * way to the busy line and **Stop waiting**; a detected change shows "Change detected from Rider.
 * Commit it below." (F-26.3, Author.dc.html `fBusy`, `fApplied`).
 */
export function AuthorThreadCard({
  thread,
  colors,
  onFixInRider,
  onFixWithClaude,
  onReply,
  riderPhase = 'idle',
  riderBusyText = '',
  onStopWaiting,
}: AuthorThreadCardProps) {
  const fixable = thread.kind === 'change' && thread.path !== null;
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
      {riderPhase === 'idle' && (
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
      {riderPhase === 'waiting' && (
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
      {riderPhase === 'changed' && (
        <span role="status" className={styles.applied}>
          <span className={styles.appliedMark} />
          Change detected from Rider. Commit it below.
        </span>
      )}
    </section>
  );
}
