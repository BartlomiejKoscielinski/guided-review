import { Button } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import type { DiffLayout } from '../../diff/rows';
import { useRiderOpen } from '../../ipc/hooks/useChanges';
import type { FileDiff } from '../../ipc/types/FileDiff';
import { FileReviewed } from '../step/FileReviewed';
import styles from './FileBar.module.css';

export interface FileBarProps {
  sessionId: string;
  /** The file as the step has it: its `+/−` stay when whitespace is ignored. */
  file: FileDiff;
  /** Repository-relative path of the file in the step. */
  path: string;
  layout: DiffLayout;
  onLayout: (layout: DiffLayout) => void;
  ignoreWhitespace: boolean;
  onIgnoreWhitespace: (on: boolean) => void;
  /** The file is marked reviewed in the step (F-07.10). */
  reviewed?: boolean;
  /** The bar's Reviewed toggle (F-07.10); without it the bar has none. */
  onReviewed?: () => void;
}

const LAYOUTS = [
  { value: 'split', label: 'Split' },
  { value: 'unified', label: 'Unified' },
] as const;

/**
 * The S-04 file bar (F-08.5, Main.dc.html), sticky at the top of the main column while its file
 * scrolls: the path with the file name in bold, `+add −del`, Split | Unified, Ignore whitespace,
 * Open in Rider at the file's first hunk, from the session's folder (F-24.1), and the file's
 * Reviewed toggle (F-07.10). A failed open shows its error under the bar.
 */
export function FileBar({
  sessionId,
  file,
  path,
  layout,
  onLayout,
  ignoreWhitespace,
  onIgnoreWhitespace,
  reviewed = false,
  onReviewed,
}: FileBarProps) {
  const rider = useRiderOpen();
  const slash = path.lastIndexOf('/');
  const dir = slash < 0 ? '' : path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const firstLine = file.hunks.find((h) => !h.fileLevel)?.newStart ?? 1;
  return (
    <div className={styles.sticky}>
      <div className={styles.bar}>
        <div className={styles.file}>
          <span className={styles.path} title={path}>
            {dir && <span className={styles.dir}>{dir}</span>}
            <b className={styles.name}>{name}</b>
          </span>
          <span className={styles.add}>{`+${String(file.additions)}`}</span>
          <span className={styles.del}>{`−${String(file.deletions)}`}</span>
        </div>
        <div className={styles.tools}>
          <Segmented
            label="Diff layout"
            size="tool"
            className={styles.layout}
            options={LAYOUTS}
            value={layout}
            onChange={onLayout}
          />
          <Button
            variant="ghost"
            size={30}
            className={styles.toggle}
            aria-pressed={ignoreWhitespace}
            onClick={() => {
              onIgnoreWhitespace(!ignoreWhitespace);
            }}
          >
            Ignore whitespace
          </Button>
          <Button
            size={30}
            disabled={file.status === 'deleted'}
            onClick={() => {
              rider.mutate({ file: path, line: firstLine, session: sessionId });
            }}
          >
            Open in Rider
          </Button>
          {onReviewed && (
            <FileReviewed path={path} reviewed={reviewed} onToggle={onReviewed} size={30} />
          )}
        </div>
      </div>
      {rider.error && (
        <p role="alert" className={styles.alert}>
          {rider.error.message}
        </p>
      )}
    </div>
  );
}
