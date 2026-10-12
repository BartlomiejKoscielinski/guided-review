import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { cx } from '../../components/cx';
import type { TreeFile } from '../../ipc/types/TreeFile';
import { FileRow } from './FileRow';
import { FolderRow } from './FolderRow';
import type { TreeRow } from './tree';
import styles from './Tree.module.css';

export interface FileTreeProps {
  rows: TreeRow[];
  selected: string | undefined;
  local: boolean;
  onSelect: (file: TreeFile) => void;
  onFolder: (dir: string, open: boolean) => void;
  onStageFiles?: (files: TreeFile[], stage: boolean) => void;
}

/** The virtualized tree of changed files (F-15.2): thin rows, smooth with 1000 files. */
export function FileTree({
  rows,
  selected,
  local,
  onSelect,
  onFolder,
  onStageFiles,
}: FileTreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual returns fresh functions each render; this component isn't memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'folder' ? 30 : 26),
    overscan: 20,
    getItemKey: (i) => {
      const row = rows[i];
      return row ? (row.kind === 'folder' ? `d:${row.dir}` : `f:${row.file.path}`) : i;
    },
  });
  return (
    <div
      ref={scrollRef}
      role="tree"
      aria-label="Files"
      className={cx(styles.list, !local && styles.commitMode)}
      data-testid="file-tree"
    >
      {rows.length === 0 ? (
        <div className={styles.noMatch}>No files match.</div>
      ) : (
        <div className={styles.sizer} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={styles.row}
                style={{ transform: `translateY(${String(item.start)}px)` }}
              >
                {row.kind === 'folder' ? (
                  <FolderRow
                    dir={row.dir}
                    open={row.open}
                    count={row.count}
                    files={row.files}
                    onStage={onStageFiles}
                    onToggle={() => {
                      onFolder(row.dir, !row.open);
                    }}
                  />
                ) : (
                  <FileRow
                    file={row.file}
                    current={row.file.path === selected}
                    onSelect={() => {
                      onSelect(row.file);
                    }}
                    onStage={
                      onStageFiles
                        ? (file, stage) => {
                            onStageFiles([file], stage);
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
