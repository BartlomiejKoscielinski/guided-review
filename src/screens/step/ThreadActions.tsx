import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { CheckIcon } from '../../components/icons';
import { useReplyThread, useResolveThread } from '../../ipc/hooks/useThreadActions';
import type { Thread } from '../../ipc/types/Thread';
import { ThreadReply } from './ThreadReply';
import styles from './Thread.module.css';

export interface ThreadActionsProps {
  sessionId: string;
  thread: Thread;
}

type Target = 'resolve' | 'reopen' | 'reply';

/**
 * A thread card's actions (F-11.2, Review.dc.html; M5 decisions 1 and 2): open, **Resolve**
 * (green) and **Reply**; resolved, the "Resolved" tag and **Reopen**. Each one goes to GitLab at
 * once and the card changes only when GitLab has it. The pressed button is busy meanwhile; a
 * failure keeps the card and the reply text and says why in one line under the buttons. The
 * keyboard focus moves to the button that took the pressed one's place.
 */
export function ThreadActions({ sessionId, thread }: ThreadActionsProps) {
  const resolve = useResolveThread(sessionId);
  const reply = useReplyThread(sessionId);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveRef = useRef<HTMLButtonElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const replyRef = useRef<HTMLButtonElement>(null);
  // Where the focus goes once the button it waits for is there (after a refetch or a close).
  const focusNext = useRef<Target | null>(null);

  useEffect(() => {
    const next = focusNext.current;
    const button =
      next === 'resolve'
        ? resolveRef.current
        : next === 'reopen'
          ? reopenRef.current
          : next === 'reply'
            ? replyRef.current
            : null;
    if (!button || button.disabled) return;
    button.focus();
    focusNext.current = null;
  });

  const setResolved = (resolved: boolean) => {
    if (resolve.isPending) return;
    setError(null);
    resolve.mutate(
      { discussion: thread.id, resolved },
      {
        onSuccess: () => {
          focusNext.current = resolved ? 'reopen' : 'resolve';
        },
        onError: (e) => {
          const what = resolved ? 'resolve the thread' : 'reopen the thread';
          setError(`Couldn't ${what}. ${e.message}`);
        },
      },
    );
  };

  const closeComposer = () => {
    setComposing(false);
    focusNext.current = 'reply';
  };

  return (
    <>
      {thread.resolved ? (
        <div className={styles.resolvedRow}>
          <span className={styles.tag}>Resolved</span>
          <Button
            ref={reopenRef}
            size={30}
            disabled={resolve.isPending}
            onClick={() => {
              setResolved(false);
            }}
          >
            Reopen
          </Button>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button
            ref={resolveRef}
            variant="approve"
            className={styles.resolve}
            disabled={resolve.isPending}
            onClick={() => {
              setResolved(true);
            }}
          >
            <CheckIcon size={13} strokeWidth={2.6} />
            Resolve
          </Button>
          {!composing && (
            <Button
              ref={replyRef}
              className={styles.reply}
              onClick={() => {
                setError(null);
                setComposing(true);
              }}
            >
              Reply
            </Button>
          )}
        </div>
      )}
      {composing && !thread.resolved && (
        <ThreadReply
          busy={reply.isPending}
          onCancel={closeComposer}
          onSend={(body) => {
            setError(null);
            reply.mutate(
              { discussion: thread.id, body },
              {
                onSuccess: closeComposer,
                onError: (e) => {
                  setError(`Couldn't send the reply. ${e.message}`);
                },
              },
            );
          }}
        />
      )}
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
