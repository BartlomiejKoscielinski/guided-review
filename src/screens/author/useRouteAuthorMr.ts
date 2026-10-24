import { useLocation, useMatches } from 'react-router';
import type { StartState } from '../../app/router';
import { useAuthorMr } from '../../ipc/hooks/useAuthorMr';
import { useRepos } from '../../ipc/hooks/useRepos';

/**
 * The MR of the S-10 route read from the active repository's GitLab project, shared by the screen
 * and its title bar (one query). A restored start reads nothing (F-30.4).
 */
export function useRouteAuthorMr() {
  const iid = Number(useMatches().at(-1)?.params.iid ?? Number.NaN);
  const restored = (useLocation().state as StartState | null)?.restored === true;
  const repos = useRepos();
  const project = repos.data?.find((r) => r.isActive)?.gitlabProject ?? undefined;
  const mr = useAuthorMr(project, iid, !restored);
  const noProject = !restored && repos.isSuccess && !project;
  return { iid, project, restored, noProject, mr };
}
