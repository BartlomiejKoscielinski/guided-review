import { usePipelineActions } from '../../ipc/hooks/usePipelineActions';
import { useJobLog } from '../../ipc/hooks/useJobLog';
import type { JobRow } from '../../ipc/types/JobRow';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { JobLog } from './JobLog';
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
  /** Full log could not open the browser. */
  onOpenError: (message: string) => void;
}

/**
 * The job details panel of S-08 (F-20.5): the selected job's square, name, status tag and meta
 * line, Retry job / Cancel job (the row's action, decision 6) and Full log (the job's page in the
 * browser); below, the streamed log on the left and, while the job runs, the running note on the
 * right. A job that never ran has no log.
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
  onOpenError,
}: JobDetailsProps) {
  const hasLog = hasJobLog(row.state);
  const log = useJobLog(project, iid, hasLog ? row.id : null);
  const { open } = usePipelineActions(project, iid);
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
      {hasLog && (
        <div className={styles.body}>
          <div className={styles.logColumn}>
            {log.error !== null && (
              <p role="alert" className={styles.alert}>
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
          </div>
        </div>
      )}
    </section>
  );
}
