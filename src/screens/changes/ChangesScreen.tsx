import { useParams } from 'react-router';
import { useActiveRepo, useRepoChangedRefresh } from '../../ipc/hooks/useChanges';
import { CommitMode } from './CommitMode';
import { LocalMode } from './LocalMode';
import { MrBrowse } from './MrBrowse';
import { PickRepository } from './PickRepository';
import styles from './Changes.module.css';

/**
 * S-06 Changes and commit (F-15, F-16): local changes or one commit of the active repository, or
 * the read-only browse of a teammate's MR session (F-24.1), which doesn't depend on it.
 */
export function ChangesScreen() {
  const { commit, sessionId } = useParams();
  const repo = useActiveRepo();
  useRepoChangedRefresh();
  if (sessionId) return <MrBrowse key={sessionId} sessionId={sessionId} />;
  if (repo.isPending) return <div className={styles.screen} />;
  if (repo.error) {
    return (
      <div className={styles.centered} role="alert">
        {repo.error.message}
      </div>
    );
  }
  if (!repo.data) return <PickRepository />;
  return commit ? <CommitMode key={commit} sha={commit} /> : <LocalMode />;
}
