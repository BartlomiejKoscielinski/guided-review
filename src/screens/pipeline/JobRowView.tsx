import { cx } from '../../components/cx';
import type { JobAction } from '../../ipc/types/JobAction';
import type { JobRow } from '../../ipc/types/JobRow';
import { JobSquare } from './JobSquare';
import { JOB_LABEL, jobMeta } from './pipelineText';
import styles from './StageColumns.module.css';

const ACTION_WORD: Record<JobAction, string> = { retry: 'Retry', run: 'Run', cancel: 'Cancel' };

export interface JobRowViewProps {
  row: JobRow;
  selected: boolean;
  /** Its Retry or Cancel is on its way. */
  busy: boolean;
  onSelect: () => void;
  onAction: (action: JobAction) => void;
}

/** The action's icon (Pipeline.dc.html): a circular arrow, a play triangle, a stop square. */
function ActionIcon({ action }: { action: JobAction }) {
  if (action === 'retry') {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="square"
        aria-hidden="true"
      >
        <path d="M13 8a5 5 0 1 1-1.6-3.7" />
        <path d="M13 2.5V5h-2.5" />
      </svg>
    );
  }
  if (action === 'run') {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M4 2.5v11l9.5-5.5z" />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" />
    </svg>
  );
}

/**
 * One job of a stage column (F-20.2): a select button (status square, name, duration or state)
 * and, beside it, never inside it, the row's one action button (decision 6).
 */
export function JobRowView({ row, selected, busy, onSelect, onAction }: JobRowViewProps) {
  const meta = jobMeta(row);
  const action = row.action;
  const label = action === null ? null : `${ACTION_WORD[action]} ${row.name}`;
  const quiet = row.state === 'skipped' || row.state === 'waiting';
  return (
    <div data-testid="job-row" className={cx(styles.row, selected && styles.rowOn)}>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${row.name}, ${JOB_LABEL[row.state]}`}
        className={styles.pick}
        onClick={onSelect}
      >
        <JobSquare state={row.state} />
        <span className={cx(styles.name, quiet && styles.nameQuiet, selected && styles.nameOn)}>
          {row.name}
        </span>
        {meta !== '' && (
          <span data-testid="job-meta" className={styles.right}>
            {meta}
          </span>
        )}
      </button>
      {action !== null && label !== null && (
        <button
          type="button"
          aria-label={label}
          title={label}
          disabled={busy}
          className={cx(styles.action, action === 'run' && styles.actionRun)}
          onClick={() => {
            onAction(action);
          }}
        >
          <ActionIcon action={action} />
        </button>
      )}
    </div>
  );
}
