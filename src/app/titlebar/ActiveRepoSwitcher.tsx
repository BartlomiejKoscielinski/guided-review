import { useActiveRepo } from '../../ipc/hooks/useChanges';
import { RepoSwitcher } from './RepoSwitcher';

/** The switcher on the active repository (S-01, S-06); nothing until one is picked. */
export function ActiveRepoSwitcher() {
  const repo = useActiveRepo();
  if (!repo.data) return null;
  return <RepoSwitcher name={repo.data.name} path={repo.data.path} />;
}
