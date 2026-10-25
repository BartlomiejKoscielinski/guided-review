import { useQuery } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { ProjectMember } from '../types/ProjectMember';
import type { ReviewerSuggestion } from '../types/ReviewerSuggestion';
import { LOCAL_KEY } from './useChanges';

/**
 * S-11's suggested reviewers for an MR into `target` (F-27.3). Under the local-changes key like
 * the branch block, so a commit, push or repository switch asks again.
 */
export function useReviewerSuggestions(target: string | undefined, enabled = true) {
  const ipc = useIpc();
  return useQuery<ReviewerSuggestion[], IpcError>({
    queryKey: [...LOCAL_KEY, 'reviewers', target ?? null],
    queryFn: () => ipc.reviewersSuggest(target),
    enabled,
  });
}

/** Project members matching `query` (already trimmed and debounced); a blank query asks nobody. */
export function useUsersSearch(query: string) {
  const ipc = useIpc();
  return useQuery<ProjectMember[], IpcError>({
    queryKey: ['gitlab', 'users-search', query],
    queryFn: () => ipc.gitlabUsersSearch(query),
    enabled: query !== '',
  });
}
