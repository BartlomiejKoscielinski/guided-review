import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { DiffView } from '../../diff/DiffView';
import { lineKey } from '../../diff/rows';
import { useAuthorFileDiff } from '../../ipc/hooks/useAuthorMr';
import { useRiderOpen } from '../../ipc/hooks/useChanges';
import type { AuthorThread } from '../../ipc/types/AuthorThread';
import type { FileDiff } from '../../ipc/types/FileDiff';
import { noteAvatarColor, splitPath } from './authorText';
import { AuthorThreadCard } from './AuthorThreadCard';
import styles from './AuthorThreadView.module.css';

export interface AuthorThreadViewProps {
  thread: AuthorThread;
  /** All listed threads (avatar colours as in the list). */
  threads: AuthorThread[];
  /** The MR's target branch: the diff runs from merge-base(origin/<target>, HEAD). */
  target: string;
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

/** Whether the diff has a row of new line `line` (the card goes under it). */
const hasLine = (diff: FileDiff, line: number) =>
  diff.hunks.some((h) => h.lines.some((l) => l.kind !== 'del' && l.newNo === line));

/**
 * S-10's main column (F-26.2, M7 decision 6): the selected thread opens in the code at its line.
 * A sticky file bar (path, **Open in Rider · line N**), the file's unified diff from
 * merge-base(origin/<target>, HEAD) to the working tree scrolled to the line, and the thread card
 * under that line. While the diff is read (after a short wait), when it failed, when the file shows no change or the
 * line is outside the diff, the card stands above the code. A General thread has no file: its
 * conversation only.
 */
export function AuthorThreadView({ thread, threads, target, scrollRoot }: AuthorThreadViewProps) {
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
  const openRider = () => {
    if (path !== null) rider.mutate({ file: path, line: line ?? 1 });
  };
  const card = (
    <AuthorThreadCard
      thread={thread}
      colors={thread.notes.map((n) => noteAvatarColor(threads, n))}
      onFixInRider={openRider}
    />
  );

  if (path === null) {
    return <div className={styles.general}>{card}</div>;
  }

  const file = diff.data;
  const showCode = file !== undefined && (file.binary || file.hunks.length > 0);
  const anchored = file !== undefined && line !== null && !file.binary && hasLine(file, line);
  const at = line !== null ? lineKey('new', line) : '';
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
      {(diff.isError || rider.isError) && (
        <p role="alert" className={styles.error}>
          {diff.error?.message ?? rider.error?.message}
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
            scrollRoot={scrollRoot}
            stickyTop={BAR}
            reveal={anchored ? { at, nonce: 1 } : undefined}
            empty={file.binary ? 'Binary file. Not shown.' : undefined}
          />
        </div>
      )}
    </>
  );
}
