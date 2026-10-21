import type { BlockColor } from '../../components/colors';
import { formatAge } from '../../format/age';
import type { AuthorThread } from '../../ipc/types/AuthorThread';
import styles from './AuthorThreadCard.module.css';

export interface AuthorThreadCardProps {
  thread: AuthorThread;
  /** The avatar colour of each note, in order. */
  colors: BlockColor[];
  /** Fix in Rider: opens the thread's file at its line. */
  onFixInRider: () => void;
  /** Fix with Claude (F-25.1 on author threads); the flow is wired by its own criterion. */
  onFixWithClaude?: () => void;
  /** Reply (F-26.5, F-26.7); the composer is wired by its own criterion. */
  onReply?: () => void;
}

/**
 * S-10's thread card (F-26.2, Author.dc.html): the conversation in order (avatar, author - my own
 * note reads "You" -, age, full text) and the actions. A change request on a file offers
 * **Fix with Claude**, **Fix in Rider** and **Reply**; a question or a General thread is answered,
 * not fixed, so it offers **Reply** only.
 */
export function AuthorThreadCard({
  thread,
  colors,
  onFixInRider,
  onFixWithClaude,
  onReply,
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
    </section>
  );
}
