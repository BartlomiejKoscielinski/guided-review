import { useNavigate } from 'react-router';
import { useState } from 'react';
import { pathFor } from '../../app/routes';
import { hunkRefs, lineRef, type DiffStaging } from '../../diff/staging';
import {
  useCommit,
  useFileDiff,
  useLastMessage,
  useLocalChanges,
  usePush,
  useRiderOpen,
  useStaging,
} from '../../ipc/hooks/useChanges';
import type { IpcError } from '../../ipc/errors';
import type { FileRef } from '../../ipc/types/FileRef';
import type { TreeFile } from '../../ipc/types/TreeFile';
import { useChangesStore } from '../../state/changes';
import { CommitFailure } from './CommitFailure';
import { CommitPanel } from './CommitPanel';
import { CreatedBlock } from './CreatedBlock';
import { DiffPane } from './DiffPane';
import { operationReason } from './operation';
import { PushFailure } from './PushFailure';
import { findFile, firstFile } from './tree';
import { TreePanel } from './TreePanel';
import { useSuggest } from './useSuggest';
import styles from './Changes.module.css';

const SOURCE = 'local';

const refOf = (file: TreeFile): FileRef => ({
  path: file.path,
  oldPath: file.oldPath,
  untracked: file.untracked,
});

/** S-06 in local mode: stage files, hunks and lines; commit; push (F-15, F-16). */
export function LocalMode() {
  const navigate = useNavigate();
  const store = useChangesStore();
  const status = useLocalChanges(true);
  const groups = status.data?.groups ?? [];
  const selectedFile = findFile(groups, store.selected[SOURCE]) ?? firstFile(groups);
  const diff = useFileDiff({ kind: 'local' }, selectedFile ? refOf(selectedFile) : null);
  const staging = useStaging();
  const commit = useCommit();
  const push = usePush();
  const lastMessage = useLastMessage();
  const rider = useRiderOpen();
  const suggest = useSuggest();
  const [pushed, setPushed] = useState<string | null>(null);
  const [pushError, setPushError] = useState<IpcError | null>(null);

  const stageFiles = (files: TreeFile[], stage: boolean) => {
    staging.mutate({ selection: { kind: 'files', files: files.map(refOf) }, stage });
  };
  const diffStaging: DiffStaging | undefined = selectedFile
    ? {
        onHunk: (hunk, stage) => {
          staging.mutate({
            selection: { kind: 'lines', file: refOf(selectedFile), lines: hunkRefs(hunk) },
            stage,
          });
        },
        onLine: (line, stage) => {
          const ref = lineRef(line);
          if (!ref) return;
          staging.mutate({
            selection: { kind: 'lines', file: refOf(selectedFile), lines: [ref] },
            stage,
          });
        },
      }
    : undefined;

  const doPush = (then?: () => void) => {
    setPushError(null);
    push.mutate(undefined, {
      onSuccess: (result) => {
        if (then) then();
        else setPushed(`Pushed to ${result.remoteBranch}.`);
      },
      onError: setPushError,
    });
  };

  const total = status.data?.totalFiles ?? 0;
  const staged = status.data?.stagedFiles ?? 0;
  const reason = operationReason(status.data?.operation);
  const created = store.created;

  return (
    <div className={styles.screen}>
      {reason && (
        <div role="alert" className={styles.banner}>
          {reason}
        </div>
      )}
      <TreePanel
        mode="local"
        commitLabel={status.data?.head?.slice(0, 7)}
        onMode={(mode) => {
          if (mode === 'commit' && status.data?.head) {
            void navigate(pathFor({ screen: 'S-06', commit: status.data.head }));
          }
        }}
        groups={groups}
        summary={`${String(staged)} of ${String(total)} in commit`}
        selected={selectedFile?.path}
        filter={store.filter}
        onFilter={store.setFilter}
        folders={store.folders[SOURCE] ?? {}}
        onFolder={(dir, open) => {
          store.setFolder(SOURCE, dir, open);
        }}
        onCollapseAll={() => {
          store.collapseAll(
            SOURCE,
            groups.map((g) => g.dir),
          );
        }}
        onSelect={(file) => {
          store.select(SOURCE, file.path);
        }}
        onStageFiles={stageFiles}
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
          notice={rider.error?.message ?? staging.error?.message}
          staging={diff.data?.lineStaging ? diffStaging : undefined}
        />
      ) : (
        <main className={styles.centered}>
          {status.isPending ? '' : status.error ? status.error.message : 'Working tree clean.'}
        </main>
      )}
      <CommitPanel
        message={store.message}
        onMessage={store.setMessage}
        amend={store.amend}
        onAmend={(amend) => {
          store.setAmend(amend);
          if (amend && store.message.trim() === '') {
            lastMessage.mutate(undefined, {
              onSuccess: (text) => {
                if (text && useChangesStore.getState().message.trim() === '') {
                  store.setMessage(text);
                }
              },
            });
          }
        }}
        stagedFiles={staged}
        blockedReason={reason}
        committing={commit.isPending || created !== null}
        onCommit={() => {
          commit.mutate(
            { message: store.message, amend: store.amend },
            {
              onSuccess: (result) => {
                store.setCreated(result);
                store.setAmend(false);
                setPushed(null);
              },
            },
          );
        }}
        suggesting={suggest.pending}
        onSuggest={suggest.run}
        suggestNotice={suggest.notice}
        top={
          <>
            {created && (
              <CreatedBlock
                created={created}
                pushing={push.isPending}
                pushed={pushed}
                onPushAndCreateMr={() => {
                  doPush(() => {
                    void navigate(pathFor({ screen: 'S-11' }));
                  });
                }}
                onPushOnly={() => {
                  doPush();
                }}
                onNewCommit={() => {
                  store.setCreated(null);
                  store.setMessage('');
                  setPushed(null);
                  setPushError(null);
                }}
              />
            )}
            {pushError && (
              <PushFailure
                error={pushError}
                onOpenRider={() => {
                  if (selectedFile) rider.mutate({ file: selectedFile.path, line: 1 });
                }}
              />
            )}
            {commit.error && <CommitFailure error={commit.error} />}
          </>
        }
      />
    </div>
  );
}
