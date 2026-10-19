import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { CheckIcon, CodeIcon } from '../../components/icons';
import { useResolveThread } from '../../ipc/hooks/useThreadActions';
import type { Thread } from '../../ipc/types/Thread';
import type { ThreadHint } from '../../ipc/types/ThreadHint';
import { revealThreadState } from '../step/threadReveal';
import { ThreadHintChip } from './ThreadHintChip';
import { threadMeta, threadPlace } from './threadMeta';
import styles from './Threads.module.css';

export interface ThreadRowProps {
  sessionId: string;
  thread: Thread;
  /** The signed-in GitLab user's username, for "You"; null while it is not known. */
  me: string | null;
  /** Where Show in code opens (the step screen on `?step=`); null for a thread no step shows. */
  code: string | null;
  /** Claude's hint when it judges the thread addressed by a later commit (F-13.3). */
  hint?: ThreadHint | null;
}

/**
 * A thread of S-05's Threads tab (F-13.2, SummaryDesk.dc.html): the resolved square, the first
 * message as plain text on one line, under it "author · N replies · file:line" (" · resolved" once
 * resolved; no `file:line` on a comment on the MR itself), and to the right Show in code (to the
 * step the thread shows in, its card scrolled into view; M5 decision 13) and the green Resolve or
 * the grey Reopen. Resolve and Reopen go to GitLab at once (`gitlab_resolve`) and the row changes
 * only when GitLab has it: the button is busy meanwhile, a failure keeps the row and says why in
 * it (M5 decision 2), and the keyboard focus moves to the button that took the pressed one's place.
 * An open thread Claude judges addressed has its hint under the meta line (F-13.3); resolved, it
 * has none.
 */
export function ThreadRow({ sessionId, thread, me, code, hint = null }: ThreadRowProps) {
  const navigate = useNavigate();
  const resolve = useResolveThread(sessionId);
  const resolveRef = useRef<HTMLButtonElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  // The button the focus goes to once it is there (after GitLab answered and the list is read).
  const focusNext = useRef<'resolve' | 'reopen' | null>(null);

  useEffect(() => {
    const button = focusNext.current === 'reopen' ? reopenRef.current : resolveRef.current;
    if (focusNext.current === null || !button || button.disabled) return;
    button.focus();
    focusNext.current = null;
  });

  const first = thread.notes[0]?.body ?? '';
  const place = threadPlace(thread);
  const busy = resolve.isPending;
  const failed = resolve.isError
    ? `Couldn't ${resolve.variables.resolved ? 'resolve' : 'reopen'} the thread. ${resolve.error.message}`
    : null;

  const setResolved = (resolved: boolean) => {
    if (busy) return;
    resolve.mutate(
      { discussion: thread.id, resolved },
      {
        onSuccess: () => {
          focusNext.current = resolved ? 'reopen' : 'resolve';
        },
      },
    );
  };

  return (
    <li className={styles.row}>
      <span
        className={cx(styles.state, thread.resolved && styles.stateResolved)}
        aria-hidden="true"
      >
        {thread.resolved && <CheckIcon size={11} strokeWidth={3.2} />}
      </span>
      <div className={styles.body}>
        <p className={cx(styles.text, thread.resolved && styles.textResolved)} title={first}>
          {first}
        </p>
        <span className={styles.meta}>
          {threadMeta(thread, me)}
          {place && (
            <>
              {' · '}
              <span className={styles.place} title={place.title}>
                {place.text}
              </span>
            </>
          )}
        </span>
        {hint !== null && !thread.resolved && <ThreadHintChip hint={hint} />}
        {failed !== null && (
          <p role="alert" className={styles.error}>
            {failed}
          </p>
        )}
      </div>
      <div className={styles.actions}>
        {code !== null && place && (
          <Link
            to={code}
            aria-label={`Show in code: ${place.text}`}
            title="Show in code"
            className={styles.code}
            onClick={(event) => {
              // Opened here, so the card's request is newer than any made before (`nextNonce`).
              event.preventDefault();
              void navigate(code, { state: revealThreadState(thread.id) });
            }}
          >
            <CodeIcon />
          </Link>
        )}
        {thread.resolved ? (
          <Button
            ref={reopenRef}
            size={34}
            className={styles.reopen}
            disabled={busy}
            onClick={() => {
              setResolved(false);
            }}
          >
            Reopen
          </Button>
        ) : (
          <Button
            ref={resolveRef}
            variant="approve"
            size={34}
            className={styles.resolve}
            disabled={busy}
            onClick={() => {
              setResolved(true);
            }}
          >
            <CheckIcon size={12} strokeWidth={3} />
            Resolve
          </Button>
        )}
      </div>
    </li>
  );
}
