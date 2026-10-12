import { useActiveRepo, useLocalChanges } from '../../ipc/hooks/useChanges';
import { BranchBlock } from './BranchBlock';
import { RepoSwitcher } from './RepoSwitcher';

/** S-06 title-bar context: the active repository and the current branch (F-30.7 list in M2). */
export function ChangesContext() {
  const repo = useActiveRepo();
  const status = useLocalChanges(Boolean(repo.data));
  if (!repo.data) return null;
  const branch = status.data?.branch;
  return (
    <>
      <RepoSwitcher name={repo.data.name} path={repo.data.path} />
      {branch && <BranchBlock branch={branch} />}
    </>
  );
}
