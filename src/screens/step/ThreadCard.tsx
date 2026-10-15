import { formatAge } from '../../format/age';
import type { Thread } from '../../ipc/types/Thread';
import styles from './Step.module.css';

export interface ThreadCardProps {
  thread: Thread;
  line: number;
}

const AVATAR = ['orange', 'green', 'blue', 'purple'] as const;

/** "PS" from "Paweł S.". */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * An existing GitLab thread as step context (F-06.9): avatars, author · age, text and replies.
 * Read-only until F-11 (M5) adds Resolve, Reply and Reopen (M3 decision 1).
 */
export function ThreadCard({ thread, line }: ThreadCardProps) {
  const authors = [...new Set(thread.notes.map((n) => n.author.username))];
  return (
    <div className={styles.inlineCard}>
      <div role="region" aria-label={`Thread at line ${String(line)}`} className={styles.thread}>
        {thread.notes.map((note, i) => (
          <div key={note.id} className={styles.threadNote}>
            <span
              className={styles.avatar}
              data-color={AVATAR[authors.indexOf(note.author.username) % AVATAR.length]}
              aria-hidden="true"
            >
              {initials(note.author.name)}
            </span>
            <span className={styles.noteText}>
              <span className={styles.byline}>
                <b>{note.author.name}</b> · {formatAge(note.createdAt)}
              </span>
              {/* Plain text: GitLab Markdown is never rendered as HTML here (06 › T10). */}
              <span className={i === 0 ? styles.firstBody : styles.replyBody}>{note.body}</span>
            </span>
          </div>
        ))}
        {thread.resolved && <span className={styles.resolved}>Resolved</span>}
      </div>
    </div>
  );
}
