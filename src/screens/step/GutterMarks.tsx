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
}

/**
 * A note's 12px gutter square in layouts A and B (F-07.5): severity color, yellow once drafted,
 * an outline once dismissed; the focused note has a yellow ring.
 */
export function NoteMark({ finding, number, focused, onFocus }: NoteMarkProps) {
  return (
    <button
      type="button"
      className={cx(
        styles.noteMark,
        styles[finding.decision === 'open' ? finding.severity : finding.decision],
        focused && styles.focusedMark,
      )}
      aria-label={`Note ${String(number)}: ${finding.title}`}
      aria-pressed={focused}
      onClick={onFocus}
    />
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
