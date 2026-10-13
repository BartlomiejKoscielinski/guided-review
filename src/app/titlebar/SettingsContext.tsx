import { useActiveRepo } from '../../ipc/hooks/useChanges';
import { ContextText } from './ContextText';

/** S-07 title-bar context: the active repository's name (when one is picked) and "Settings". */
export function SettingsContext() {
  const repo = useActiveRepo();
  return (
    <>
      {repo.data && <ContextText kind="repo">{repo.data.name}</ContextText>}
      <ContextText kind="title">Settings</ContextText>
    </>
  );
}
