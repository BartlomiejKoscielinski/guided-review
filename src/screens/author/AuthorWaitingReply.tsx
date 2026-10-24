import { useState } from 'react';
import { Button } from '../../components/Button';
import { SpinnerIcon } from '../../components/icons';
import { useAuthorPushAndReply } from '../../ipc/hooks/useAuthorMr';
import type { WaitingReply } from '../../ipc/types/WaitingReply';
import { firstName } from './authorText';
import styles from './AuthorCommitPanel.module.css';

export interface AuthorWaitingReplyProps {
  threadId: string;
  project: string;
  iid: number;
  /** The thread's author ("Marta K."): the reply goes to their thread. */
  author: string;
  /** The MR's source branch, for "Pushing to origin/<branch>…". */
  branch: string;
  /** The reply `author_mr` found queued for this thread. */
  waiting: WaitingReply;
  onOpenRider: () => void;
}

const PULL_FIRST = "The remote has commits you don't have. Pull with rebase in Rider.";

type Status = 'idle' | 'pullFirst' | 'done';

/**
 * S-10 reopened with a reply still queued for the thread (F-26.5, M7 decision 12), never sent by
 * itself: when its commit is already on origin, "Pushed. Reply not sent yet." with **Send reply**
 * (the core skips the push); else "Committed <sha> · not pushed yet" with **Push and reply**, as
 * right after Commit. A failure, also the one stored before the restart, offers **Retry**.
 */
export function AuthorWaitingReply({
  threadId,
  project,
  iid,
  author,
  branch,
  waiting,
  onOpenRider,
}: AuthorWaitingReplyProps) {
  const [body, setBody] = useState(waiting.reply.body);
  const [resolve, setResolve] = useState(waiting.reply.resolve);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(waiting.reply.error);
  const push = useAuthorPushAndReply({
    onMutate: () => {
      setError(null);
      setStatus('idle');
    },
    onSuccess: (outcome) => {
      setStatus(outcome.kind === 'done' ? 'done' : 'pullFirst');
    },
    onError: (e) => {
      setError(e.message);
    },
  });

  if (status === 'done') {
    return (
      <div className={styles.head}>
        <span className={styles.committed}>Pushed</span>
      </div>
    );
  }
  if (push.isPending) {
    return (
      <span role="status" className={styles.busy}>
        <SpinnerIcon className={styles.spinner} />
        {waiting.pushed ? 'Sending the reply…' : `Pushing to origin/${branch}…`}
      </span>
    );
  }

  const blank = body.trim() === '';
  const onSend = () => {
    if (blank) return;
    push.mutate({
      project,
      iid,
      discussion: threadId,
      body,
      resolve,
      afterSha: waiting.reply.afterSha,
    });
  };
  const replyId = `waiting-reply-${threadId}`;
  const action = waiting.pushed ? 'Send reply' : 'Push and reply';

  return (
    <>
      <div className={styles.head}>
        {waiting.pushed ? (
          <>
            <span className={styles.committed}>Pushed.</span>
            <span className={styles.pending}>Reply not sent yet.</span>
          </>
        ) : (
          <>
            <span className={styles.committed}>Committed</span>
            <span className={styles.sha}>{waiting.reply.afterSha.slice(0, 7)}</span>
            <span className={styles.pending}>not pushed yet</span>
          </>
        )}
      </div>
      <div className={styles.reply}>
        <span className={styles.caption}>
          {waiting.pushed
            ? `Sent to ${firstName(author)}’s thread`
            : `Sent to ${firstName(author)}’s thread after push`}
        </span>
        <label htmlFor={replyId} className="visually-hidden">
          Reply to send
        </label>
        <textarea
          id={replyId}
          rows={2}
          className={styles.replyText}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
          }}
        />
        <label className={styles.fixup}>
          <input
            type="checkbox"
            checked={resolve}
            onChange={(e) => {
              setResolve(e.target.checked);
            }}
          />
          Resolve the thread
        </label>
      </div>
      {status === 'pullFirst' && (
        <div role="alert" className={styles.pull}>
          <span className={styles.pullTitle}>Pull first</span>
          <span>{PULL_FIRST}</span>
          <button type="button" className={styles.link} onClick={onOpenRider}>
            Open in Rider
          </button>
        </div>
      )}
      {error !== null && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="primary" size={40} disabled={blank} onClick={onSend}>
          {error !== null ? 'Retry' : action}
        </Button>
        <span className={styles.note}>
          {waiting.pushed
            ? 'Nothing is sent until you click Send reply.'
            : 'The reply waits for the push, so the link always works.'}
        </span>
      </div>
    </>
  );
}
