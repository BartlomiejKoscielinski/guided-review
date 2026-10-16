import { useEffect, useRef } from 'react';
import { Button } from '../../components/Button';
import { CheckIcon } from '../../components/icons';
import type { Thread } from '../../ipc/types/Thread';
import { ThreadReply } from './ThreadReply';
import { useThreadCard, type ThreadScope } from './useThreadCard';
import styles from './Thread.module.css';

export interface ThreadActionsProps {
  scope: ThreadScope;
  thread: Thread;
}

type Target = 'resolve' | 'reopen' | 'reply';

/**
 * A thread card's actions (F-11.2, Review.dc.html; M5 decisions 1 and 2): open, **Resolve**
 * (green) and **Reply**; resolved, the "Resolved" tag and **Reopen**. Each one goes to GitLab at
 * once and the card changes only when GitLab has it. The pressed button is busy meanwhile; a
 * failure keeps the card and the reply text and says why in one line under the buttons. The
 * keyboard focus moves to the button that took the pressed one's place. The composer, its text,
 * the busy state and the error outlive the card (`useThreadCard`); an open composer stays open
 * when the thread is resolved meanwhile (GitLab takes replies on resolved threads too) and closes
 * only on Cancel, Esc or a sent reply.
 */
export function ThreadActions({ scope, thread }: ThreadActionsProps) {
  const card = useThreadCard(scope, thread.id);
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
            ? // A resolved thread has no Reply: its Reopen takes the composer's focus.
              (replyRef.current ?? reopenRef.current)
            : null;
    if (!button || button.disabled) return;
    button.focus();
    focusNext.current = null;
  });

  const setResolved = (resolved: boolean) => {
    card.setResolved(resolved, () => {
      focusNext.current = resolved ? 'reopen' : 'resolve';
    });
  };

  return (
    <>
      {thread.resolved ? (
        <div className={styles.resolvedRow}>
          <span className={styles.tag}>Resolved</span>
          <Button
            ref={reopenRef}
            size={30}
            disabled={card.resolving}
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
            disabled={card.resolving}
            onClick={() => {
              setResolved(true);
            }}
          >
            <CheckIcon size={13} strokeWidth={2.6} />
            Resolve
          </Button>
          {!card.composing && (
            <Button ref={replyRef} className={styles.reply} onClick={card.open}>
              Reply
            </Button>
          )}
        </div>
      )}
      {card.composing && (
        <ThreadReply
          text={card.text}
          focus={card.focus}
          onFocused={card.focused}
          onText={card.type}
          busy={card.sending}
          onCancel={() => {
            card.close();
            focusNext.current = 'reply';
          }}
          onSend={(body) => {
            card.reply(body, () => {
              focusNext.current = 'reply';
            });
          }}
        />
      )}
      {card.error !== null && (
        <p className={styles.error} role="alert">
          {card.error}
        </p>
      )}
    </>
  );
}
