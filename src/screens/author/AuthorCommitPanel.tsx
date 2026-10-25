import { Button } from '../../components/Button';
import { ClaudeIcon } from '../../components/icons';
import {
  useAuthorCommit,
  useAuthorFixupTarget,
  useAuthorQueueReply,
} from '../../ipc/hooks/useAuthorMr';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { WaitingReply } from '../../ipc/types/WaitingReply';
import { useAuthorCommitStore } from '../../state/authorCommit';
import { CommitFailure } from '../changes/CommitFailure';
import { useSuggest } from '../changes/useSuggest';
import { AuthorPushPanel } from './AuthorPushPanel';
import { AuthorWaitingReply } from './AuthorWaitingReply';
import { fixedReply, splitPath } from './authorText';
import styles from './AuthorCommitPanel.module.css';

export interface AuthorCommitPanelProps {
  /** The thread whose fix this commits; its draft is kept by this ID. */
  threadId: string;
  path: string;
  line: number | null;
  /** The MR's target branch (the fixup range starts at its merge base). */
  target: string;
  /** The file's diff, for the "+N −M" next to its name. */
  diff: FileDiff | undefined;
  /** My MR: where the reply goes after the push (F-26.5). */
  project: string;
  iid: number;
  /** The thread's author, the MR's source branch and Open in Rider, for the push panel. */
  author: string;
  branch: string;
  /** A reply still queued for the thread on reopen: shown when no draft is open (decision 12). */
  waiting?: WaitingReply;
  onOpenRider: () => void;
  /** Read-only author mode (F-26.8): no Commit, no Push; Send reply of a pushed reply stays. */
  readOnly?: boolean;
}

/**
 * S-10's commit panel after a fix (F-26.4, Author.dc.html `cStage`; M7 decisions 8 to 10): the
 * message prefilled without Claude, **Suggest** on click, the switch "As a fixup of <sha>
 * “<subject>”" (on) with its note, and **Commit** of the fixed file alone. Commit waits for the
 * fixup target so a commit is never silently a plain one; a target that can't be read leaves a
 * separate commit, said so. A hook's rejection shows its output; the form stays. Done:
 * "Committed" and the short SHA; the reply "Fixed in <sha>. <one sentence>." is queued at once
 * and **Push and reply** follows (F-26.5).
 */
export function AuthorCommitPanel({
  threadId,
  path,
  line,
  target,
  diff,
  project,
  iid,
  author,
  branch,
  waiting,
  onOpenRider,
  readOnly = false,
}: AuthorCommitPanelProps) {
  const draft = useAuthorCommitStore((s) => s.drafts[threadId]);
  const update = useAuthorCommitStore((s) => s.update);
  const shown = !readOnly && draft !== undefined && draft.committed === null;
  const fixupTarget = useAuthorFixupTarget(target, path, line, shown);
  const commit = useAuthorCommit();
  const queue = useAuthorQueueReply({
    onSuccess: (queued) => {
      update(threadId, { replyId: queued.id });
    },
    onError: (error) => {
      update(threadId, { pushError: error.message });
    },
  });
  // Suggest describes the fixed file as Commit takes it, never what else is staged (decision 10).
  const suggest = useSuggest(
    (message) => {
      update(threadId, { message });
    },
    [path],
  );
  // F-26.8: off the source branch nothing is committed or pushed from here; a reply whose commit is
  // already on origin can still be sent (M7 decision 14).
  if (readOnly && (draft !== undefined ? draft.push !== 'done' : waiting?.pushed !== true)) {
    return null;
  }
  if (!draft) {
    if (!waiting) return null;
    return (
      <div className={styles.dock}>
        <section aria-label="Commit and push" className={styles.panel}>
          <AuthorWaitingReply
            key={waiting.reply.id}
            threadId={threadId}
            project={project}
            iid={iid}
            author={author}
            branch={branch}
            waiting={waiting}
            onOpenRider={onOpenRider}
          />
        </section>
      </div>
    );
  }

  if (draft.committed) {
    return (
      <div className={styles.dock}>
        <section aria-label="Commit and push" className={styles.panel}>
          <AuthorPushPanel
            threadId={threadId}
            project={project}
            iid={iid}
            author={author}
            branch={branch}
            draft={draft}
            committed={draft.committed}
            onOpenRider={onOpenRider}
          />
        </section>
      </div>
    );
  }

  const found = fixupTarget.data;
  const asFixup = found !== undefined && draft.fixup;
  const ready = found !== undefined || fixupTarget.isError;
  const disabled = !ready || commit.isPending || draft.message.trim() === '';
  const note = asFixup
    ? `Marked as a fixup of ${found.shortSha}. Fold it in with git rebase --autosquash before merging, or merge with Squash commits.`
    : 'Stays a separate commit.';
  const onCommit = () => {
    if (disabled) return;
    commit.mutate(
      { message: draft.message, fixup: asFixup ? found.sha : null, path },
      {
        onSuccess: (committed) => {
          // F-26.5: the reply is queued in the core at once; nothing is sent before the push.
          const reply = fixedReply(committed.shortSha, draft.message);
          update(threadId, { committed, reply });
          queue.mutate({
            project,
            iid,
            discussion: threadId,
            body: reply,
            resolve: draft.resolve,
            afterSha: committed.sha,
          });
        },
      },
    );
  };

  return (
    <div className={styles.dock}>
      <section aria-label="Commit and push" className={styles.panel}>
        <div className={styles.head}>
          <span className={styles.title}>Commit the fix</span>
          <span className={styles.file}>
            {splitPath(path).name}
            {diff && diff.hunks.length > 0 && (
              <>
                {' '}
                <span className={styles.add}>{`+${String(diff.additions)}`}</span>{' '}
                <span className={styles.del}>{`−${String(diff.deletions)}`}</span>
              </>
            )}
          </span>
        </div>
        <div className={styles.messageRow}>
          <label htmlFor={`commit-fix-${threadId}`} className="visually-hidden">
            Commit message
          </label>
          <input
            id={`commit-fix-${threadId}`}
            type="text"
            className={styles.message}
            value={draft.message}
            onChange={(e) => {
              update(threadId, { message: e.target.value });
            }}
          />
          <Button variant="claude" size={40} disabled={suggest.pending} onClick={suggest.run}>
            <ClaudeIcon />
            {suggest.pending ? 'Claude is writing…' : 'Suggest'}
          </Button>
        </div>
        {suggest.notice}
        {found && (
          <label className={styles.fixup}>
            <input
              type="checkbox"
              checked={draft.fixup}
              onChange={(e) => {
                update(threadId, { fixup: e.target.checked });
              }}
            />
            As a fixup of <span className={styles.sha}>{found.shortSha}</span>
            {` “${found.subject}”`}
          </label>
        )}
        {fixupTarget.isError && (
          <p role="alert" className={styles.error}>
            {fixupTarget.error.message}
          </p>
        )}
        {commit.error && <CommitFailure error={commit.error} />}
        <div className={styles.actions}>
          <Button variant="primary" size={40} disabled={disabled} onClick={onCommit}>
            Commit
          </Button>
          {ready && <span className={styles.note}>{note}</span>}
        </div>
      </section>
    </div>
  );
}
