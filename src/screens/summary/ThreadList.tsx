import { pathFor, stepScreen } from '../../app/routes';
import { useGitlabStatus } from '../../ipc/hooks/useGitlab';
import { useSessionState } from '../../ipc/hooks/useSessionState';
import type { Thread } from '../../ipc/types/Thread';
import { ThreadRow } from './ThreadRow';
import { useThreadSteps } from './useThreadSteps';
import summary from './Summary.module.css';

export interface ThreadListProps {
  sessionId: string;
  threads: readonly Thread[];
  draftsOnly: boolean;
}

/**
 * The rows, once GitLab answered with threads: only then are the signed-in user and the steps
 * read, so a restored summary or a failed read runs no command for them (F-30.4).
 */
export function ThreadList({ sessionId, threads, draftsOnly }: ThreadListProps) {
  const me = useGitlabStatus().data?.user?.username ?? null;
  const mode = useSessionState(sessionId).data?.mode;
  const steps = useThreadSteps(sessionId, !draftsOnly);
  const path = pathFor({ screen: stepScreen(mode), sessionId });
  return (
    <ul className={summary.notes}>
      {threads.map((thread) => {
        const step = steps.get(thread.id);
        return (
          <ThreadRow
            key={thread.id}
            sessionId={sessionId}
            thread={thread}
            me={me}
            code={step === undefined ? null : `${path}?step=${encodeURIComponent(step)}`}
          />
        );
      })}
    </ul>
  );
}
