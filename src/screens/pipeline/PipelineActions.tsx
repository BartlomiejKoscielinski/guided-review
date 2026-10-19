import { Button } from '../../components/Button';
import { usePipelineActions } from '../../ipc/hooks/usePipelineActions';
import type { PipelineHead } from '../../ipc/types/PipelineHead';
import type { StageColumn } from '../../ipc/types/StageColumn';
import { hasRetryableJob, refusalOf } from './pipelineText';

export interface PipelineActionsProps {
  project: string;
  iid: number;
  /** The selected pipeline; null on a restored start or while there is none. */
  pipeline: number | null;
  /** Its head and its jobs; none while they load. */
  head: PipelineHead | undefined;
  jobs: StageColumn[] | undefined;
  /** GitLab's 403 reason after a refused write (decision 9): the writes are disabled. */
  refused: string | null;
  onRefused: (reason: string) => void;
  /** The failure line under the head; null clears it (a new attempt). */
  onFailure: (text: string | null) => void;
  /** Open in GitLab is offered (not when the MR has no pipeline). */
  showOpen: boolean;
}

/**
 * S-08's pipeline actions before Run new pipeline (F-20.4, Pipeline.dc.html): Retry failed jobs
 * when the pipeline is not running and a job failed or was canceled, Cancel pipeline while it
 * runs, and Open in GitLab (the pipeline's `webUrl` in the default browser, decision 13). Retry
 * and Cancel act at once, without a dialog (decision 6), and are busy until GitLab answers.
 */
export function PipelineActions({
  project,
  iid,
  pipeline,
  head,
  jobs,
  refused,
  onRefused,
  onFailure,
  showOpen,
}: PipelineActionsProps) {
  const actions = usePipelineActions(project, iid);
  const loaded = pipeline !== null && head !== undefined && jobs !== undefined;
  const running = head?.status === 'running';
  const canRetry = loaded && !running && hasRetryableJob(jobs);
  const canCancel = loaded && running;
  const webUrl = pipeline !== null ? (head?.webUrl ?? null) : null;

  const failWith = (prefix: string) => (e: unknown) => {
    const reason = e instanceof Error ? e.message : String(e);
    onFailure(`${prefix} ${reason}`);
    const refusal = refusalOf(e);
    if (refusal !== null) onRefused(refusal);
  };
  const write = (kind: 'retry' | 'cancel') => {
    const mutation = actions[kind];
    if (pipeline === null || refused !== null || mutation.isPending) return;
    onFailure(null);
    mutation.mutate(pipeline, {
      onError: failWith(
        kind === 'retry' ? "Couldn't retry the failed jobs." : "Couldn't cancel the pipeline.",
      ),
    });
  };
  const open = () => {
    if (webUrl === null) return;
    onFailure(null);
    actions.open.mutate(webUrl, { onError: failWith("Couldn't open GitLab.") });
  };

  return (
    <>
      {canRetry && (
        <Button
          size={40}
          disabled={actions.retry.isPending || refused !== null}
          aria-busy={actions.retry.isPending}
          title={refused ?? undefined}
          onClick={() => {
            write('retry');
          }}
        >
          Retry failed jobs
        </Button>
      )}
      {canCancel && (
        <Button
          size={40}
          disabled={actions.cancel.isPending || refused !== null}
          aria-busy={actions.cancel.isPending}
          title={refused ?? undefined}
          onClick={() => {
            write('cancel');
          }}
        >
          Cancel pipeline
        </Button>
      )}
      {showOpen && (
        <Button variant="ghost" size={40} disabled={webUrl === null} onClick={open}>
          Open in GitLab
        </Button>
      )}
    </>
  );
}
