import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { pathFor } from '../../app/routes';
import { formatAge } from '../../format/age';
import { useCommitInfo, useFileDiff, useRiderOpen } from '../../ipc/hooks/useChanges';
import { useChangesStore } from '../../state/changes';
import { CommitDetails } from './CommitDetails';
import { DiffPane } from './DiffPane';
import { files } from './operation';
import { findFile, firstFile } from './tree';
import { TreePanel } from './TreePanel';
import styles from './Changes.module.css';

export interface CommitModeProps {
  sha: string;
}

/** S-06 in commit mode: the commit's files and its details panel (F-15.6). */
export function CommitMode({ sha }: CommitModeProps) {
  const navigate = useNavigate();
  const store = useChangesStore();
  const source = `commit:${sha}`;
  const info = useCommitInfo(sha, true);
  const groups = info.data?.groups ?? [];
  const selectedFile = findFile(groups, store.selected[source]) ?? firstFile(groups);
  const diff = useFileDiff(
    { kind: 'commit', sha },
    selectedFile
      ? { path: selectedFile.path, oldPath: selectedFile.oldPath, untracked: false }
      : null,
  );
  const rider = useRiderOpen();

  // A commit that doesn't exist (anymore): back to local changes (02 › S-06).
  const missing = info.isError;
  useEffect(() => {
    if (missing) void navigate(pathFor({ screen: 'S-06' }), { replace: true });
  }, [missing, navigate]);

  const data = info.data;
  return (
    <div className={styles.screen}>
      <TreePanel
        mode="commit"
        commitLabel={data?.shortSha ?? sha.slice(0, 7)}
        onMode={(mode) => {
          if (mode === 'local') void navigate(pathFor({ screen: 'S-06' }));
        }}
        groups={groups}
        summary={data ? `${files(data.totalFiles)} · ${data.author} · ${formatAge(data.date)}` : ''}
        selected={selectedFile?.path}
        filter={store.filter}
        onFilter={store.setFilter}
        folders={store.folders[source] ?? {}}
        onFolder={(dir, open) => {
          store.setFolder(source, dir, open);
        }}
        onCollapseAll={() => {
          store.collapseAll(
            source,
            groups.map((g) => g.dir),
          );
        }}
        onSelect={(file) => {
          store.select(source, file.path);
        }}
      />
      {selectedFile ? (
        <DiffPane
          file={selectedFile}
          diff={diff.data}
          layout={store.layout}
          onLayout={store.setLayout}
          onOpenInRider={(line) => {
            rider.mutate({ file: selectedFile.path, line });
          }}
          notice={rider.error?.message}
        />
      ) : (
        <div className={styles.centered} />
      )}
      {data && <CommitDetails info={data} />}
    </div>
  );
}
