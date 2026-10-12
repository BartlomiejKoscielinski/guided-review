import { Checkbox } from '../../components/Checkbox';
import { CollapseAllIcon, SearchIcon } from '../../components/icons';
import { Segmented } from '../../components/Segmented';
import type { FileGroup } from '../../ipc/types/FileGroup';
import type { TreeFile } from '../../ipc/types/TreeFile';
import { FileTree } from './FileTree';
import { filterCount, flattenTree, stageCheck } from './tree';
import styles from './Tree.module.css';

export interface TreePanelProps {
  mode: 'local' | 'commit';
  /** Short SHA for "Commit <sha>" (F-15.1); the toggle is disabled without one. */
  commitLabel: string | undefined;
  onMode: (mode: 'local' | 'commit') => void;
  groups: readonly FileGroup[];
  /** "80 of 100 in commit" (local) or "3 files · Marta K. · 2 h ago" (commit). */
  summary: string;
  selected: string | undefined;
  filter: string;
  onFilter: (filter: string) => void;
  folders: Readonly<Record<string, boolean>>;
  onFolder: (dir: string, open: boolean) => void;
  onCollapseAll: () => void;
  onSelect: (file: TreeFile) => void;
  /** Local mode: stage or unstage whole files (F-16.1, F-16.3). */
  onStageFiles?: (files: TreeFile[], stage: boolean) => void;
}

/** S-06 left panel: source toggle, filter, master checkbox and the file tree. */
export function TreePanel(props: TreePanelProps) {
  const { mode, groups, filter, onStageFiles } = props;
  const local = mode === 'local';
  const all = groups.flatMap((g) => g.files);
  const master = stageCheck(all);
  const rows = flattenTree(groups, {
    filter,
    local,
    selected: props.selected,
    folders: props.folders,
  });
  return (
    <nav aria-label="Changed files" className={styles.panel}>
      <div className={styles.head}>
        <Segmented
          label="Source"
          size="fill"
          value={mode}
          onChange={props.onMode}
          options={[
            { value: 'local', label: 'Local changes' },
            {
              value: 'commit',
              label: props.commitLabel ? `Commit ${props.commitLabel}` : 'Commit',
              disabled: props.commitLabel === undefined,
            },
          ]}
        />
        <div className={styles.filter}>
          <SearchIcon size={14} />
          <input
            aria-label="Filter files"
            className={styles.filterInput}
            placeholder="Filter files"
            value={filter}
            onChange={(e) => {
              props.onFilter(e.target.value);
            }}
          />
          <span className={styles.count} aria-label="Matching files">
            {filterCount(groups, filter)}
          </span>
        </div>
        <div className={styles.master}>
          {local && onStageFiles && (
            <Checkbox
              state={master}
              label="Include all files"
              onToggle={() => {
                onStageFiles(all, master !== 'on');
              }}
            />
          )}
          <span className={styles.masterLabel}>{props.summary}</span>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Collapse all folders"
            title="Collapse all"
            onClick={props.onCollapseAll}
          >
            <CollapseAllIcon />
          </button>
        </div>
      </div>
      <FileTree
        rows={rows}
        selected={props.selected}
        local={local}
        onSelect={props.onSelect}
        onFolder={props.onFolder}
        onStageFiles={local ? onStageFiles : undefined}
      />
    </nav>
  );
}
