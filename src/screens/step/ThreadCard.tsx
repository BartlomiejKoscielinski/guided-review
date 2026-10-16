import { Tag } from '../../components/Tag';
import { formatAge } from '../../format/age';
import type { Thread } from '../../ipc/types/Thread';
import styles from './Step.module.css';
import { ThreadActions } from './ThreadActions';
import threadStyles from './Thread.module.css';
import type { ThreadScope } from './useThreadCard';

export interface ThreadCardProps {
  thread: Thread;
  /** The line the card is under; without it the card is on the file header of `file` (F-11.3). */
  line?: number;
  /** The file whose header the card is on, when it has no `line`. */
  file?: string;
  /**
   * The MR session and the step it is shown on: the card has Resolve, Reply and Reopen (F-11.2).
   * Without it the card is read-only context.
   */
  scope?: ThreadScope;
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
 * An existing GitLab thread as step context (F-06.9): avatars, author · age, text and replies,
 * then its actions (F-11.2): Resolve and Reply, or the "Resolved" tag and Reopen. A thread written
 * on another version of the MR has the neutral "Outdated" word tag after its first byline
 * (F-11.3, M5 decision 4).
 */
export function ThreadCard({ thread, line, file, scope }: ThreadCardProps) {
  const authors = [...new Set(thread.notes.map((n) => n.author.username))];
  const label = line === undefined ? `Thread on ${file ?? ''}` : `Thread at line ${String(line)}`;
  return (
    <div className={styles.inlineCard}>
      <div role="region" aria-label={label} className={styles.thread}>
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
                {i === 0 && thread.outdated && (
                  <span className={threadStyles.outdated}>
                    <Tag color="muted" size="s">
                      Outdated
                    </Tag>
                  </span>
                )}
              </span>
              {/* Plain text: GitLab Markdown is never rendered as HTML here (06 › T10). */}
              <span className={i === 0 ? styles.firstBody : styles.replyBody}>{note.body}</span>
            </span>
          </div>
        ))}
        {scope !== undefined ? (
          <ThreadActions scope={scope} thread={thread} />
        ) : (
          thread.resolved && (
            <div className={threadStyles.resolvedRow}>
              <span className={threadStyles.tag}>Resolved</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
