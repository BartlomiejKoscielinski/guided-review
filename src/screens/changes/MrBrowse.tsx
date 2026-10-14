import { useLocation, useNavigate } from 'react-router';
import { pathFor } from '../../app/routes';
import { formatAge } from '../../format/age';
import { useFileDiff, useRiderOpen } from '../../ipc/hooks/useChanges';
import { useSessionMr } from '../../ipc/hooks/useSources';
import { useChangesStore } from '../../state/changes';
import { browseFiles } from './browseFilter';
import { DiffPane } from './DiffPane';
import { MrDetails } from './MrDetails';
import { files } from './operation';
import { findFile, firstFile, onlyFiles } from './tree';
import { TreePanel } from './TreePanel';
import styles from './Changes.module.css';

export interface MrBrowseProps {
  sessionId: string;
}

/**
 * S-06 MR browse (F-06.11 Browse files instead, F-24.1): the files of a teammate's MR session,
 * read-only, with Open in Rider from the folder `rider.openFrom` picks. A skim row's Show (F-06.6)
 * opens it with only that row's files (the navigation state, `browseFilter`).
 */
export function MrBrowse({ sessionId }: MrBrowseProps) {
  const navigate = useNavigate();
  const store = useChangesStore();
  const source = `mr:${sessionId}`;
  const session = useSessionMr(sessionId);
  const data = session.data ?? null;
  const only = browseFiles(useLocation().state);
  const groups = only && data ? onlyFiles(data.groups, only) : (data?.groups ?? []);
  const selectedFile = findFile(groups, store.selected[source]) ?? firstFile(groups);
  const diff = useFileDiff(
    { kind: 'session', sessionId },
    selectedFile
      ? { path: selectedFile.path, oldPath: selectedFile.oldPath, untracked: false }
      : null,
  );
  const rider = useRiderOpen();

  if (session.error || (session.isSuccess && !data)) {
    return (
      <div className={styles.centered} role="alert">
        {session.error?.message ?? 'This session has no merge request.'}
      </div>
    );
  }
  const shown = groups.reduce((n, g) => n + g.files.length, 0);
  const total = data ? files(data.totalFiles) : '';
  const count = only ? `${String(shown)} of ${total}` : total;
  const summary = data
    ? [count, data.mr.author, data.mr.createdAt && formatAge(data.mr.createdAt)]
        .filter(Boolean)
        .join(' · ')
    : '';
  return (
    <div className={styles.screen}>
      <TreePanel
        mode="mr"
        commitLabel={undefined}
        mrLabel={data ? `!${String(data.mr.iid)}` : ''}
        onMode={(mode) => {
          if (mode === 'local') void navigate(pathFor({ screen: 'S-06' }));
        }}
        groups={groups}
        summary={summary}
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
            rider.mutate({ file: selectedFile.path, line, session: sessionId });
          }}
          notice={rider.error?.message}
        />
      ) : (
        <div className={styles.centered} />
      )}
      {data && <MrDetails session={data} />}
    </div>
  );
}
