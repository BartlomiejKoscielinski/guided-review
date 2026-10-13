import { useActiveRepo, useLocalChanges } from '../../ipc/hooks/useChanges';
import { ActiveRepoSwitcher } from './ActiveRepoSwitcher';
import { BranchBlock } from './BranchBlock';

/** S-06 title-bar context: the active repository (F-30.7) and the current branch. */
export function ChangesContext() {
  const repo = useActiveRepo();
  const status = useLocalChanges(Boolean(repo.data));
  if (!repo.data) return null;
  const branch = status.data?.branch;
  return (
    <>
      <ActiveRepoSwitcher />
      {branch && <BranchBlock branch={branch} />}
    </>
  );
}
