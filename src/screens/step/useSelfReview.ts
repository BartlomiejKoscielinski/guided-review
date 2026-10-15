import { useSessionMr } from '../../ipc/hooks/useSources';

/**
 * Whether the session is a self-review (F-17): commits or local changes, with no MR behind it, so
 * nothing reaches GitLab. Notes are kept to fix instead of added to drafts, and no thread is shown.
 * An MR session, one still being looked up and an unknown one keep the MR copy. The query is the
 * one the title bar and S-02 already run, so S-03 asks nothing more.
 */
export function useSelfReview(sessionId: string): boolean {
  return useSessionMr(sessionId).data === null;
}

/**
 * The same, but unknown (undefined) while the session is looked up, so a screen guesses neither
 * the MR copy nor the self-review copy (S-04, as its info header); a failed lookup keeps the MR
 * copy, as S-03 does.
 */
export function useSelfReviewKnown(sessionId: string): boolean | undefined {
  const mr = useSessionMr(sessionId);
  if (mr.isPending) return undefined;
  return mr.data === null;
}
