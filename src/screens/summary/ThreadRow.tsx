import { cx } from '../../components/cx';
import { CheckIcon } from '../../components/icons';
import type { Thread } from '../../ipc/types/Thread';
import styles from './Threads.module.css';

export interface ThreadRowProps {
  thread: Thread;
}

/**
 * A thread of S-05's Threads tab (SummaryDesk.dc.html): the resolved square (an outlined square
 * while open, the green one with a tick once resolved) and the thread's first message as plain
 * text, grey once resolved. F-13.2 adds the author, replies, file:line and Resolve / Reopen.
 */
export function ThreadRow({ thread }: ThreadRowProps) {
  const first = thread.notes[0]?.body ?? '';
  return (
    <li className={styles.row}>
      <span
        className={cx(styles.state, thread.resolved && styles.stateResolved)}
        aria-hidden="true"
      >
        {thread.resolved && <CheckIcon size={11} strokeWidth={3.2} />}
      </span>
      <div className={styles.body}>
        <p className={cx(styles.text, thread.resolved && styles.textResolved)}>{first}</p>
      </div>
    </li>
  );
}
