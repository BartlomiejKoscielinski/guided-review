import { useParams } from 'react-router';
import { useActiveRepo, useRepoChangedRefresh } from '../../ipc/hooks/useChanges';
import { CommitMode } from './CommitMode';
import { LocalMode } from './LocalMode';
import { PickRepository } from './PickRepository';
import styles from './Changes.module.css';

/** S-06 Changes and commit (F-15, F-16): local changes or one commit of the active repository. */
export function ChangesScreen() {
  const { commit } = useParams();
  const repo = useActiveRepo();
  useRepoChangedRefresh();
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
