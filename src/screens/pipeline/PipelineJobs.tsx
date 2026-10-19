import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../../ipc/errors';
import { useJobActions } from '../../ipc/hooks/usePipeline';
import type { JobAction } from '../../ipc/types/JobAction';
import type { JobRow } from '../../ipc/types/JobRow';
import type { StageColumn } from '../../ipc/types/StageColumn';
import { StageColumns } from './StageColumns';
import { firstJobToShow } from './pipelineText';
import styles from './Pipeline.module.css';

export interface PipelineJobsProps {
  project: string;
  iid: number;
  pipeline: number;
  jobs: UseQueryResult<StageColumn[], IpcError>;
}

/**
 * The jobs of the selected pipeline (F-20.2): the stage columns once they are read (nothing while
 * they load, the error as an alert), the selected job (the first that did not pass when the
 * pipeline opens) and the row actions. Retry and Cancel act at once, without a confirmation;
 * Retry selects its row and the selection follows the new attempt by name; a manual job's Run
 * only selects the job (its form is F-20.6). Mount it with `key={pipeline}`.
 */
export function PipelineJobs({ project, iid, pipeline, jobs }: PipelineJobsProps) {
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
    if (action === 'run') return;
    setError(null);
    setBusy((ids) => new Set(ids).add(row.id));
    const mutation = action === 'retry' ? actions.retry : actions.cancel;
    mutation
      .mutateAsync(row.id)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
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
        onSelect={setPicked}
        onAction={act}
      />
    </>
  );
}
