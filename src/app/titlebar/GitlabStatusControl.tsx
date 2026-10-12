import { useNavigate } from 'react-router';
import { StatusChip } from '../../components/StatusChip';
import { useGitlabStatus } from '../../ipc/hooks/useGitlab';
import type { GitlabStatus } from '../../ipc/types/GitlabStatus';
import { GITLAB_SETTINGS_ROUTE, pathFor } from '../routes';
import { StatusText } from './StatusText';

/** A token GitLab doesn't accept (expired, revoked, missing scope) is fixed by adding a new one. */
function needsToken(status: GitlabStatus): boolean {
  if (status.state === 'noToken') return true;
  const code = status.problem?.code;
  return code === 'GITLAB_UNAUTHORIZED' || code === 'GITLAB_FORBIDDEN';
}

/**
 * S-01: "GitLab connected" with a green square (F-01.6). A failing check turns orange and
 * offers the fixing action: "Add token" opens Settings › GitLab.
 */
export function GitlabStatusControl() {
  const navigate = useNavigate();
  const status = useGitlabStatus();
  if (!status.data) return null;
  if (status.data.state === 'connected') {
    return <StatusText color="green">GitLab connected</StatusText>;
  }
  const openSettings = () => {
    void navigate(pathFor(GITLAB_SETTINGS_ROUTE));
  };
  if (needsToken(status.data)) {
    return <StatusChip color="orange" label="Add token" onOpen={openSettings} />;
  }
  return (
    <StatusChip
      color="orange"
      label="GitLab"
      title={status.data.problem?.message}
      onOpen={openSettings}
    />
  );
}
