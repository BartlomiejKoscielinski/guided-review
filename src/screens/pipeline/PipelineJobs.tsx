import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../../ipc/errors';
import { useJobActions } from '../../ipc/hooks/usePipeline';
import type { JobAction } from '../../ipc/types/JobAction';
import type { JobRow } from '../../ipc/types/JobRow';
import type { StageColumn } from '../../ipc/types/StageColumn';
import { StageColumns } from './StageColumns';
import { firstJobToShow, refusalOf } from './pipelineText';
import styles from './Pipeline.module.css';

export interface PipelineJobsProps {
  project: string;
  iid: number;
  pipeline: number;
  jobs: UseQueryResult<StageColumn[], IpcError>;
  /** GitLab's 403 reason after a refused write (F-20.4, decision 9): Retry and Cancel are off. */
  refused?: string | null;
  onRefused?: (reason: string) => void;
}

/**
 * The jobs of the selected pipeline (F-20.2): the stage columns once they are read (nothing while
 * they load, the error as an alert), the selected job (the first that did not pass when the
 * pipeline opens) and the row actions. Retry and Cancel act at once, without a confirmation;
 * Retry selects its row and the selection follows the new attempt by name; a manual job's Run
 * only selects the job (its form is F-20.6). A refused (403) Retry or Cancel disables them all
 * with GitLab's reason (decision 9). Mount it with `key={pipeline}`.
 */
export function PipelineJobs({
  project,
  iid,
  pipeline,
  jobs,
  refused = null,
  onRefused,
}: PipelineJobsProps) {
  const actions = useJobActions(project, iid, pipeline);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const columns = jobs.data;
  if (picked === null && columns) {
    const first = firstJobToShow(columns);
    if (first !== null) setPicked(first);
  }

  if (jobs.isError) {
    return (
      <p role="alert" className={styles.error}>
        {jobs.error.message}
      </p>
    );
  }
  if (!columns) return null;

  const act = (row: JobRow, action: JobAction) => {
    if (action !== 'cancel') setPicked(row.name);
    if (action === 'run' || refused !== null) return;
    setError(null);
    setBusy((ids) => new Set(ids).add(row.id));
    const mutation = action === 'retry' ? actions.retry : actions.cancel;
    mutation
      .mutateAsync(row.id)
      .catch((e: unknown) => {
        const reason = e instanceof Error ? e.message : String(e);
        const verb = action === 'retry' ? 'retry' : 'cancel';
        setError(`Couldn't ${verb} the job. ${reason}`);
        const refusal = refusalOf(e);
        if (refusal !== null) onRefused?.(refusal);
      })
      .finally(() => {
        setBusy((ids) => {
          const next = new Set(ids);
          next.delete(row.id);
          return next;
        });
      });
  };

  return (
    <>
      {error !== null && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <StageColumns
        columns={columns}
        selected={picked}
        busy={busy}
        refused={refused}
        onSelect={setPicked}
        onAction={act}
      />
    </>
  );
}
