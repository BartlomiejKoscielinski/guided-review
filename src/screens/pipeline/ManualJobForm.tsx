import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { CrossIcon, PlayIcon } from '../../components/icons';
import { useJobVariables } from '../../ipc/hooks/usePipeline';
import type { JobVariable } from '../../ipc/types/JobVariable';
import { type VariableRow, rowProblem, toSend } from './jobVariables';
import styles from './ManualJobForm.module.css';

export interface ManualJobFormProps {
  project: string;
  jobName: string;
  /** The pipeline's head SHA ("Runs on <sha> as you."); null while it is not known. */
  sha: string | null;
  /** The play is on its way. */
  busy: boolean;
  /** GitLab's 403 reason after a refused write (decision 9): Run is disabled with it. */
  refused: string | null;
  onRun: (vars: JobVariable[]) => void;
}

/**
 * The manual-job form of S-08's job details (F-20.6, Pipeline.dc.html): "Variables for this run"
 * (the last values that job name ran with on this machine, else none), "+ Add variable", and
 * Run `<job>`, the only control that plays the job, with "Runs on <sha> as you.". The description
 * line is not shown: GitLab's Jobs API sends none. Names follow decision 11; a row with a bad name
 * blocks Run and says so, a row with both fields empty is dropped.
 */
export function ManualJobForm(props: ManualJobFormProps) {
  const saved = useJobVariables(props.project, props.jobName);
  if (saved.isPending) return null;
  return <VariablesForm key={props.jobName} {...props} initial={saved.data ?? []} />;
}

let nextRowId = 0;
const newRow = (key = '', value = ''): VariableRow => {
  nextRowId += 1;
  return { id: nextRowId, key, value };
};

function VariablesForm({
  jobName,
  sha,
  busy,
  refused,
  onRun,
  initial,
}: ManualJobFormProps & { initial: JobVariable[] }) {
  const [rows, setRows] = useState<VariableRow[]>(() => initial.map((v) => newRow(v.key, v.value)));
  const base = useId();
  const blocked = rows.some((r) => rowProblem(r) !== null);
  const edit = (id: number, change: Partial<VariableRow>) => {
    setRows((all) => all.map((r) => (r.id === id ? { ...r, ...change } : r)));
  };

  return (
    <div className={styles.form}>
      <div className={styles.vars}>
        <span className={styles.label}>Variables for this run</span>
        {rows.map((row, index) => {
          const problem = rowProblem(row);
          const errorId = `${base}-${String(row.id)}`;
          return (
            <div key={row.id} className={styles.rowWrap}>
              <div className={styles.row}>
                <input
                  type="text"
                  aria-label="Variable name"
                  className={styles.input}
                  value={row.key}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={problem !== null || undefined}
                  aria-describedby={problem !== null ? errorId : undefined}
                  onChange={(e) => {
                    edit(row.id, { key: e.target.value });
                  }}
                />
                <input
                  type="text"
                  aria-label="Variable value"
                  className={styles.input}
                  value={row.value}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => {
                    edit(row.id, { value: e.target.value });
                  }}
                />
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Remove variable ${row.key.trim() || String(index + 1)}`}
                  title="Remove variable"
                  onClick={() => {
                    setRows((all) => all.filter((r) => r.id !== row.id));
                  }}
                >
                  <CrossIcon />
                </button>
              </div>
              {problem !== null && (
                <span id={errorId} className={styles.problem}>
                  {problem}
                </span>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className={styles.add}
          onClick={() => {
            setRows((all) => [...all, newRow()]);
          }}
        >
          + Add variable
        </button>
      </div>
      <div className={styles.runLine}>
        <Button
          variant="primary"
          size={40}
          disabled={busy || blocked || refused !== null}
          aria-busy={busy}
          title={refused ?? undefined}
          onClick={() => {
            onRun(toSend(rows));
          }}
        >
          <PlayIcon />
          Run {jobName}
        </Button>
        {sha !== null && (
          <span className={styles.runsOn}>
            Runs on <span className={styles.sha}>{sha.slice(0, 7)}</span> as you.
          </span>
        )}
      </div>
    </div>
  );
}
