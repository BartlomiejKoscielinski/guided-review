import { cx } from '../../components/cx';
import type { JobAction } from '../../ipc/types/JobAction';
import type { JobRow } from '../../ipc/types/JobRow';
import type { StageColumn } from '../../ipc/types/StageColumn';
import { JobRowView } from './JobRowView';
import { jobCount, stageState } from './pipelineText';
import styles from './StageColumns.module.css';

export interface StageColumnsProps {
  columns: StageColumn[];
  /** The name of the selected job (a retry keeps the name, not the id). */
  selected: string | null;
  /** The ids of the jobs whose Retry or Cancel is on its way. */
  busy: ReadonlySet<number>;
  onSelect: (name: string) => void;
  onAction: (row: JobRow, action: JobAction) => void;
}

/**
 * S-08's stages as columns in the core's order (F-20.2, decision 5): a heading with the stage's
 * dot, its name and its job count, then one row per job.
 */
export function StageColumns({ columns, selected, busy, onSelect, onAction }: StageColumnsProps) {
  return (
    <div className={styles.grid}>
      {columns.map((column) => (
        <section key={column.name} aria-label={column.name} className={styles.stage}>
          <div className={styles.stageHead}>
            <span
              aria-hidden="true"
              className={cx(
                styles.stageDot,
                styles[`dot-${stageState(column.jobs.map((j) => j.state))}`],
              )}
            />
            <h2 className={styles.stageName}>{column.name}</h2>
            <span data-testid="stage-count" className={styles.count}>
              {jobCount(column.jobs.length)}
            </span>
          </div>
          {column.jobs.map((row) => (
            <JobRowView
              key={row.id}
              row={row}
              selected={row.name === selected}
              busy={busy.has(row.id)}
              onSelect={() => {
                onSelect(row.name);
              }}
              onAction={(action) => {
                onAction(row, action);
              }}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
