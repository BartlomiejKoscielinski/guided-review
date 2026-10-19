import { usePipelineActions } from '../../ipc/hooks/usePipelineActions';
import { useJobExplain } from '../../ipc/hooks/useJobExplain';
import { useJobLog } from '../../ipc/hooks/useJobLog';
import type { JobRow } from '../../ipc/types/JobRow';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import type { JobVariable } from '../../ipc/types/JobVariable';
import { ExplainFailure } from './ExplainFailure';
import { JobLog } from './JobLog';
import { ManualJobForm } from './ManualJobForm';
import { JobSquare } from './JobSquare';
import { JOB_LABEL, hasJobLog, jobDetailsMeta } from './pipelineText';
import columnStyles from './StageColumns.module.css';
import styles from './JobDetails.module.css';

export interface JobDetailsProps {
  project: string;
  iid: number;
  row: JobRow;
  /** The stage column the job is in. */
  stage: string;
  /** Its Retry or Cancel is on its way. */
  busy: boolean;
  /** GitLab's 403 reason (decision 9): Retry job and Cancel job are disabled with it. */
  refused: string | null;
  onRetry: () => void;
  onCancel: () => void;
  /** The pipeline's head SHA the manual-job form names; null while it is not known. */
  sha: string | null;
  /** The manual-job form's Run `<job>` (F-20.6), the only play. */
  onPlay: (vars: JobVariable[]) => void;
  /** Full log could not open the browser. */
  onOpenError: (message: string) => void;
  /** An Explain failure `pipeline #N` chip selects that pipeline's tab (F-20.7). */
  onSelectPipeline?: (number: number) => void;
}

/**
 * The job details panel of S-08 (F-20.5): the selected job's square, name, status tag and meta
 * line, Retry job / Cancel job (the row's action, decision 6) and Full log (the job's page in the
 * browser); below, the streamed log on the left and, while the job runs, the running note on the
 * right. A job that never ran has no log; a manual job shows its form instead (F-20.6). A failed
 * job (an allowed failure too) shows "Why it failed" with Explain failure on the right (F-20.7).
 */
export function JobDetails({
  project,
  iid,
  row,
  stage,
  busy,
  refused,
  onRetry,
  onCancel,
  sha,
  onPlay,
  onOpenError,
  onSelectPipeline = () => undefined,
}: JobDetailsProps) {
  const hasLog = hasJobLog(row.state);
  const log = useJobLog(project, iid, hasLog ? row.id : null);
  const { open } = usePipelineActions(project, iid);
  const explain = useJobExplain(project, iid, row.id);
  // The panel keeps one alert: once Explain failure ran, its outcome is the live region and a
  // log that couldn't be read stays on screen as a status (F-20.7).
  const explained = explain.running || explain.failed || explain.result !== undefined;
  const running = row.state === 'running';
  const off = busy || refused !== null;
  const tip = refused ?? undefined;

  const openLog = () => {
    if (row.webUrl === null) return;
    open.mutate(row.webUrl, {
      onError: (e) => {
        onOpenError(`Couldn't open GitLab. ${e.message}`);
      },
    });
  };

  return (
    <section aria-label="Job details" className={styles.panel}>
      <div className={styles.head}>
        <JobSquare state={row.state} />
        <span className={styles.name}>{row.name}</span>
        <span data-testid="job-status" className={cx(styles.tag, columnStyles[`sq-${row.state}`])}>
          {JOB_LABEL[row.state]}
        </span>
        <span className={styles.meta}>{jobDetailsMeta(row, stage)}</span>
        <span className={styles.buttons}>
          {row.action === 'retry' && (
            <Button size={34} disabled={off} title={tip} onClick={onRetry}>
              Retry job
            </Button>
          )}
          {row.action === 'cancel' && (
            <Button size={34} disabled={off} title={tip} onClick={onCancel}>
              Cancel job
            </Button>
          )}
          <Button variant="ghost" size={34} disabled={row.webUrl === null} onClick={openLog}>
            Full log
          </Button>
        </span>
      </div>
      {row.state === 'manual' && (
        <ManualJobForm
          project={project}
          jobName={row.name}
          sha={sha}
          busy={busy}
          refused={refused}
          onRun={onPlay}
        />
      )}
      {hasLog && (
        <div className={styles.body}>
          <div className={styles.logColumn}>
            {log.error !== null && (
              <p role={explained ? 'status' : 'alert'} className={styles.alert}>
                {log.error}
              </p>
            )}
            <JobLog
              lines={log.lines}
              truncated={log.truncated}
              running={running}
              replaces={log.replaces}
            />
          </div>
          <div className={styles.side}>
            {running && (
              <span role="status" className={styles.running}>
                <span className={styles.runningDot} aria-hidden="true" />
                Running. The log streams on the left.
              </span>
            )}
            {(row.state === 'failed' || row.state === 'failedAllowed') && (
              <ExplainFailure iid={iid} explain={explain} onSelectPipeline={onSelectPipeline} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
