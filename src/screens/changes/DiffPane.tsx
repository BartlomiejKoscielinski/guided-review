import { Button } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import { DiffView } from '../../diff/DiffView';
import type { DiffLayout } from '../../diff/rows';
import type { DiffStaging } from '../../diff/staging';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { TreeFile } from '../../ipc/types/TreeFile';
import { FileStatusTag } from './FileStatusTag';
import styles from './Changes.module.css';

export interface DiffPaneProps {
  file: TreeFile;
  diff: FileDiff | undefined;
  layout: DiffLayout;
  onLayout: (layout: DiffLayout) => void;
  onOpenInRider: (line: number) => void;
  staging?: DiffStaging;
  /** An error of the last action (Open in Rider, staging). */
  notice?: string;
}

const LAYOUTS = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Split' },
] as const;

/** Center of S-06: file path, Unified | Split, Open in Rider, and the diff (F-15.5). */
export function DiffPane({
  file,
  diff,
  layout,
  onLayout,
  onOpenInRider,
  staging,
  notice,
}: DiffPaneProps) {
  const slash = file.path.lastIndexOf('/');
  const dir = slash < 0 ? '' : file.path.slice(0, slash + 1);
  const firstLine = diff?.hunks.find((h) => !h.fileLevel)?.newStart ?? 1;
  const empty = diff?.binary
    ? 'Binary file. Not shown.'
    : diff?.modeChange
      ? `Mode changed: ${diff.modeChange}.`
      : 'No text changes.';
  return (
    <section className={styles.main} aria-label="Diff">
      <div className={styles.fileBar}>
        <span className={styles.filePath}>
          <span className={styles.dirPart}>
            {dir}
            <b className={styles.namePart}>{file.name}</b>
          </span>
          <FileStatusTag file={file} long />
        </span>
        <span className={styles.tools}>
          <Segmented
            label="Diff layout"
            size="tool"
            options={LAYOUTS}
            value={layout}
            onChange={onLayout}
          />
          <Button
            size={30}
            disabled={file.status === 'deleted'}
            onClick={() => {
              onOpenInRider(firstLine);
            }}
          >
            Open in Rider
          </Button>
        </span>
      </div>
      {notice && (
        <p role="alert" className={styles.paneNotice}>
          {notice}
        </p>
      )}
      {diff && (
        <DiffView
          path={file.path}
          diff={diff}
          layout={layout}
          staging={staging}
          note={
            staging && diff.lineStaging
              ? 'Shift + click line numbers to pick single lines.'
              : undefined
          }
          empty={empty}
        />
      )}
    </section>
  );
}
