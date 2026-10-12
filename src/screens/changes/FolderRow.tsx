import { Checkbox } from '../../components/Checkbox';
import { ChevronRightIcon } from '../../components/icons';
import { cx } from '../../components/cx';
import type { TreeFile } from '../../ipc/types/TreeFile';
import { stageCheck } from './tree';
import styles from './Tree.module.css';

export interface FolderRowProps {
  dir: string;
  open: boolean;
  count: string;
  files: TreeFile[];
  /** Local mode: the tri-state folder checkbox (F-16.1). */
  onStage?: (files: TreeFile[], stage: boolean) => void;
  onToggle: () => void;
}

/** A directory row of the tree: chevron, checkbox (local), path, number of files (F-15.2). */
export function FolderRow({ dir, open, count, files, onStage, onToggle }: FolderRowProps) {
  const state = stageCheck(files);
  const name = dir === '' ? '.' : dir;
  return (
    <div
      role="treeitem"
      aria-expanded={open}
      aria-label={name}
      className={cx(styles.folder, open && styles.open)}
    >
      <button
        type="button"
        className={styles.chevron}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
        onClick={onToggle}
      >
        <ChevronRightIcon size={10} strokeWidth={2.6} className={styles.chevronIcon} />
      </button>
      {onStage ? (
        <Checkbox
          state={state}
          label={`Include folder ${name}`}
          onToggle={() => {
            onStage(files, state !== 'on');
          }}
        />
      ) : (
        <span />
      )}
      <span className={styles.dir} title={name}>
        {name}
      </span>
      <span className={styles.dirCount}>{count}</span>
    </div>
  );
}
