import { Button } from '../../components/Button';
import { SpinnerIcon } from '../../components/icons';
import { useAuthorPushAndReply } from '../../ipc/hooks/useAuthorMr';
import type { CommitResult } from '../../ipc/types/CommitResult';
import { useAuthorCommitStore, type AuthorCommitDraft } from '../../state/authorCommit';
import { AuthorPushedPipeline } from './AuthorPushedPipeline';
import { firstName, pushedText } from './authorText';
import styles from './AuthorCommitPanel.module.css';

export interface AuthorPushPanelProps {
  threadId: string;
  project: string;
  iid: number;
  /** The thread's author ("Marta K."): the reply goes to their thread. */
  author: string;
  /** The MR's source branch, for "Pushing to origin/<branch>…". */
  branch: string;
  draft: AuthorCommitDraft;
  committed: CommitResult;
  onOpenRider: () => void;
}

const PULL_FIRST = "The remote has commits you don't have. Pull with rebase in Rider.";

/**
 * S-10 after Commit (F-26.5, Author.dc.html `cPush`, M7 decisions 11 and 12): "Committed <sha> ·
 * not pushed yet", the reply to be sent (editable), "Resolve the thread" (on) and **Push and
 * reply**, which queues the reply as shown and pushes; the reply is sent only after the push.
 * A remote with commits the checkout lacks is "Pull first" (nothing pushed); a failure keeps
 * everything and offers **Retry**. All of it lives in the thread's draft, so it outlives picking
 * another thread. After the push (F-26.6): "Pushed", what was sent and the new pipeline's link.
 */
export function AuthorPushPanel({
  threadId,
  project,
  iid,
  author,
  branch,
  draft,
  committed,
  onOpenRider,
}: AuthorPushPanelProps) {
  const update = useAuthorCommitStore((s) => s.update);
  const push = useAuthorPushAndReply({
    onMutate: () => {
      update(threadId, { push: 'pushing', pushError: null });
    },
    onSuccess: (outcome) => {
      update(
        threadId,
        outcome.kind === 'done'
          ? { push: 'done', resolve: outcome.resolved, pushedAt: Date.now() }
          : { push: 'pullFirst' },
      );
    },
    onError: (error) => {
      update(threadId, { push: 'failed', pushError: error.message });
    },
  });

  if (draft.push === 'done') {
    return (
      <div className={styles.head}>
        <span className={styles.committed}>Pushed</span>
        <span className={styles.done}>{pushedText(author, draft.resolve)}</span>
        <AuthorPushedPipeline
          project={project}
          iid={iid}
          sha={committed.sha}
          pushedAt={draft.pushedAt}
        />
      </div>
    );
  }
  if (draft.push === 'pushing') {
    return (
      <span role="status" className={styles.busy}>
        <SpinnerIcon className={styles.spinner} />
        {`Pushing to origin/${branch}…`}
      </span>
    );
  }

  const blank = draft.reply.trim() === '';
  const onPush = () => {
    if (blank || push.isPending) return;
    push.mutate({
      project,
      iid,
      discussion: threadId,
      body: draft.reply,
      resolve: draft.resolve,
      afterSha: committed.sha,
    });
  };
  const replyId = `push-reply-${threadId}`;

  return (
    <>
      <div className={styles.head}>
        <span className={styles.committed}>Committed</span>
        <span className={styles.sha}>{committed.shortSha}</span>
        <span className={styles.pending}>not pushed yet</span>
      </div>
      <div className={styles.reply}>
        <span className={styles.caption}>{`Sent to ${firstName(author)}’s thread after push`}</span>
        <label htmlFor={replyId} className="visually-hidden">
          Reply to send
        </label>
        <textarea
          id={replyId}
          rows={2}
          className={styles.replyText}
          value={draft.reply}
          onChange={(e) => {
            update(threadId, { reply: e.target.value });
          }}
        />
        <label className={styles.fixup}>
          <input
            type="checkbox"
            checked={draft.resolve}
            onChange={(e) => {
              update(threadId, { resolve: e.target.checked });
            }}
          />
          Resolve the thread
        </label>
      </div>
      {draft.push === 'pullFirst' && (
        <div role="alert" className={styles.pull}>
          <span className={styles.pullTitle}>Pull first</span>
          <span>{PULL_FIRST}</span>
          <button type="button" className={styles.link} onClick={onOpenRider}>
            Open in Rider
          </button>
        </div>
      )}
      {draft.pushError !== null && (
        <p role="alert" className={styles.error}>
          {draft.pushError}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="primary" size={40} disabled={blank} onClick={onPush}>
          {draft.push === 'failed' ? 'Retry' : 'Push and reply'}
        </Button>
        <span className={styles.note}>The reply waits for the push, so the link always works.</span>
      </div>
    </>
  );
}
