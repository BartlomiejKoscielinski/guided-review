import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { DiffView } from '../../diff/DiffView';
import { lineKey } from '../../diff/rows';
import { useAuthorFileDiff } from '../../ipc/hooks/useAuthorMr';
import { useRiderOpen } from '../../ipc/hooks/useChanges';
import type { AuthorThread } from '../../ipc/types/AuthorThread';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { WaitingReply } from '../../ipc/types/WaitingReply';
import { noteAvatarColor, splitPath } from './authorText';
import { useAuthorCommitStore } from '../../state/authorCommit';
import { AuthorCommitPanel } from './AuthorCommitPanel';
import { AuthorQuestionReply } from './AuthorQuestionReply';
import { AuthorThreadCard } from './AuthorThreadCard';
import styles from './AuthorThreadView.module.css';
import { useFixInRider } from './useFixInRider';

export interface AuthorThreadViewProps {
  thread: AuthorThread;
  /** All listed threads (avatar colours as in the list). */
  threads: AuthorThread[];
  /** The MR's target branch: the diff runs from merge-base(origin/<target>, HEAD). */
  target: string;
  /** The MR's source branch, the project and the MR, for Push and reply (F-26.5). */
  source: string;
  project: string;
  iid: number;
  /** The reply found queued for this thread on reopen (M7 decision 12). */
  waiting?: WaitingReply;
  /** S-10's main column, which scrolls the diff. */
  scrollRoot: RefObject<HTMLElement | null>;
}

/** The file bar's height: a line scrolled to the top sits under it. */
const BAR = 50;

/**
 * How long a read of the file may take before the card shows above the code: a quick read puts
 * it at its line at once instead of making it jump there.
 */
const PATIENCE_MS = 250;

/** Where the card goes: the thread's working-tree line, or the removed line of the old side. */
interface Anchor {
  side: 'old' | 'new';
  no: number;
}

/** Whether the diff has a row of `anchor`'s line on its side (the card goes under it). */
const hasLine = (diff: FileDiff, { side, no }: Anchor) =>
  diff.hunks.some((h) =>
    h.lines.some((l) =>
      side === 'new' ? l.kind !== 'del' && l.newNo === no : l.kind !== 'add' && l.oldNo === no,
    ),
  );

/**
 * S-10's main column (F-26.2, M7 decision 6): the selected thread opens in the code at its line.
 * A sticky file bar (path, **Open in Rider · line N**), the file's unified diff from
 * merge-base(origin/<target>, HEAD) to the working tree scrolled to the line, and the thread card
 * under that line (a thread on a removed line: under that removed row). While the diff is read (after a short wait), when it failed, when the file shows no change or the
 * line is outside the diff, the card stands above the code. A General thread has no file: its
 * conversation only. A fix of the file brings the commit panel under the code (F-26.4).
 */
export function AuthorThreadView({
  thread,
  threads,
  target,
  source,
  waiting,
  project,
  iid,
  scrollRoot,
}: AuthorThreadViewProps) {
  const diff = useAuthorFileDiff(target, thread.path);
  const rider = useRiderOpen();
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setWaited(true);
    }, PATIENCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  const path = thread.path;
  const line = thread.line;
  const fixInRider = useFixInRider(path, line ?? 1, target);
  const openCommit = useAuthorCommitStore((s) => s.open);
  const draft = useAuthorCommitStore((s) => s.drafts[thread.id]);
  const changed = fixInRider.phase === 'changed';
  useEffect(() => {
    // F-26.4, M7 decision 9: the message is prefilled without Claude after a Rider change.
    if (changed && path !== null) {
      openCommit(thread.id, `Address review on ${splitPath(path).name}:${String(line ?? 1)}`);
    }
  }, [changed, line, openCommit, path, thread.id]);
  const openRider = () => {
    if (path !== null) rider.mutate({ file: path, line: line ?? 1 });
  };
  const card = (
    <AuthorThreadCard
      thread={thread}
      colors={thread.notes.map((n) => noteAvatarColor(threads, n))}
      onFixInRider={fixInRider.start}
      riderPhase={fixInRider.phase}
      riderBusyText={
        path !== null
          ? `Opened ${splitPath(path).name}:${String(line ?? 1)} in Rider. Waiting for your change…`
          : ''
      }
      onStopWaiting={fixInRider.stop}
      pushed={draft?.push === 'done' ? (draft.resolve ? 'resolved' : 'replied') : undefined}
      answer={
        thread.kind === 'question' ? (
          <AuthorQuestionReply thread={thread} project={project} iid={iid} />
        ) : undefined
      }
    />
  );

  if (path === null) {
    return <div className={styles.general}>{card}</div>;
  }

  const file = diff.data;
  const showCode = file !== undefined && (file.binary || file.hunks.length > 0);
  const anchor: Anchor | null =
    line !== null
      ? { side: 'new', no: line }
      : thread.oldLine !== null
        ? { side: 'old', no: thread.oldLine }
        : null;
  const anchored = file !== undefined && anchor !== null && !file.binary && hasLine(file, anchor);
  const at = anchor !== null ? lineKey(anchor.side, anchor.no) : '';
  const inserts = new Map<string, ReactNode>();
  if (anchored) inserts.set(at, <div className={styles.insert}>{card}</div>);
  const { dir, name } = splitPath(path);

  return (
    <>
      <div className={styles.bar}>
        <span className={styles.path}>
          {dir}
          <b>{name}</b>
        </span>
        <button type="button" className={styles.rider} onClick={openRider}>
          {line !== null ? `Open in Rider · line ${String(line)}` : 'Open in Rider'}
        </button>
      </div>
      {(diff.isError || rider.isError || fixInRider.error !== null) && (
        <p role="alert" className={styles.error}>
          {diff.error?.message ?? rider.error?.message ?? fixInRider.error?.message}
        </p>
      )}
      {!anchored && (!diff.isPending || waited) && <div className={styles.loose}>{card}</div>}
      {showCode && (
        <div className={styles.code}>
          <DiffView
            path={path}
            diff={file}
            layout="unified"
            inserts={inserts}
            keep={anchored ? new Set([at]) : undefined}
            selection={anchored ? { side: anchor.side, start: anchor.no, end: anchor.no } : null}
            scrollRoot={scrollRoot}
            stickyTop={BAR}
            reveal={anchored ? { at, nonce: 1 } : undefined}
            empty={file.binary ? 'Binary file. Not shown.' : undefined}
          />
        </div>
      )}
      <AuthorCommitPanel
        threadId={thread.id}
        path={path}
        line={line}
        target={target}
        diff={file}
        project={project}
        iid={iid}
        author={thread.author}
        branch={source}
        waiting={waiting}
        onOpenRider={openRider}
      />
    </>
  );
}
