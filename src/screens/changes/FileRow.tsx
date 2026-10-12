import { Checkbox } from '../../components/Checkbox';
import { cx } from '../../components/cx';
import type { TreeFile } from '../../ipc/types/TreeFile';
import { FileStatusTag } from './FileStatusTag';
import styles from './Tree.module.css';

export interface FileRowProps {
  file: TreeFile;
  current: boolean;
  onSelect: () => void;
  /** Local mode: the file checkbox (F-16.1). */
  onStage?: (file: TreeFile, stage: boolean) => void;
}

const STATUS_WORD = {
  added: 'New file',
  deleted: 'Deleted file',
  renamed: 'Renamed',
  copied: 'Copied',
  modified: 'Modified',
} as const;

/** A file row: checkbox (local), name with its status tag, `+add −del` (F-15.4). */
export function FileRow({ file, current, onSelect, onStage }: FileRowProps) {
  const check = file.staged === 'all' ? 'on' : file.staged === 'partial' ? 'mixed' : 'off';
  const title =
    (file.oldPath && file.status === 'renamed'
      ? `Renamed from ${file.oldPath}`
      : STATUS_WORD[file.status]) + ` · ${file.path}`;
  return (
    <div
      role="treeitem"
      aria-selected={current}
      className={cx(styles.file, current && styles.current)}
    >
      {onStage && (
        <Checkbox
          state={check}
          label={`Include ${file.name}`}
          onToggle={() => {
            onStage(file, check !== 'on');
          }}
        />
      )}
      <button type="button" className={styles.select} title={title} onClick={onSelect}>
        <span
          className={cx(
            styles.name,
            onStage && check === 'off' && styles.dimName,
            file.status === 'deleted' && styles.struck,
          )}
        >
          {file.name}
        </span>
        <FileStatusTag file={file} />
      </button>
      <span className={styles.stats}>
        <span className={styles.adds}>{file.additions ? `+${String(file.additions)}` : ''}</span>{' '}
        <span className={styles.dels}>{file.deletions ? `−${String(file.deletions)}` : ''}</span>
      </span>
    </div>
  );
}
