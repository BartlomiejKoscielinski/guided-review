import { cx } from '../../components/cx';
import { CommentIcon } from '../../components/icons';
import type { Finding } from '../../ipc/types/Finding';
import type { Thread } from '../../ipc/types/Thread';
import styles from './Step.module.css';

export interface NoteMarkProps {
  finding: Finding;
  number: number;
  focused: boolean;
  onFocus: () => void;
  /** Layout C: the square carries the note's number, as in the guide panel. */
  numbered?: boolean;
}

/**
 * A note's gutter square (F-07.5): 12px in layouts A and B, numbered in C; severity color, yellow
 * once drafted, an outline once dismissed; the focused note has a yellow ring.
 */
export function NoteMark({ finding, number, focused, onFocus, numbered = false }: NoteMarkProps) {
  return (
    <button
      type="button"
      className={cx(
        styles.noteMark,
        numbered && styles.numberedMark,
        styles[finding.decision === 'open' ? finding.severity : finding.decision],
        focused && styles.focusedMark,
      )}
      aria-label={`Note ${String(number)}: ${finding.title}`}
      aria-pressed={focused}
      onClick={onFocus}
    >
      {numbered ? String(number) : null}
    </button>
  );
}

export interface ThreadMarkProps {
  thread: Thread;
  line: number;
  open: boolean;
  onToggle: () => void;
}

/** The thread icon on a line with an existing thread (F-07.5); it opens and closes the card. */
export function ThreadMark({ thread, line, open, onToggle }: ThreadMarkProps) {
  const author = thread.notes[0]?.author.name ?? '';
  return (
    <button
      type="button"
      className={cx(styles.threadMark, thread.resolved && styles.threadResolved)}
      aria-label={`Thread by ${author} at line ${String(line)}${thread.resolved ? ', resolved' : ''}`}
      aria-expanded={open}
      title="Thread"
      onClick={onToggle}
    >
      <CommentIcon />
    </button>
  );
}
