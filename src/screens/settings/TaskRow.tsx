import type { BlockColor } from '../../components/colors';
import type { ClaudeSettings } from '../../ipc/types/ClaudeSettings';
import type { ModelInfo } from '../../ipc/types/ModelInfo';
import type { TaskEffort } from '../../ipc/types/TaskEffort';
import type { TaskOverride } from '../../ipc/types/TaskOverride';
import { taskModel } from '../../app/titlebar/modelLabel';
import { EFFORTS, unsupported } from './efforts';
import type { TaskInfo } from './tasks';
import styles from './Settings.module.css';

const SWATCH: Record<BlockColor, string> = {
  yellow: 'var(--yellow)',
  orange: 'var(--orange)',
  blue: 'var(--blue)',
  purple: 'var(--purple)',
  white: 'var(--white-block)',
  green: 'var(--green)',
};

export interface TaskRowProps {
  task: TaskInfo;
  settings: ClaudeSettings;
  models: readonly ModelInfo[];
  onChange: (override: TaskOverride) => void;
}

/** One Per task row: swatch, name, hint, model and effort selects (F-18.3, F-18.4). */
export function TaskRow({ task, settings, models, onChange }: TaskRowProps) {
  const current = settings.tasks[task.group];
  const resolved = taskModel(settings, task.group);
  return (
    <div className={styles.task}>
      <span
        className={styles.swatch}
        style={{ background: SWATCH[task.color] }}
        aria-hidden="true"
      />
      <span className={styles.taskText}>
        <span className={styles.taskName}>{task.label}</span>
        <span className={styles.subtitle}>{task.hint}</span>
      </span>
      <select
        className={styles.taskSelect}
        aria-label={`Model for ${task.label}`}
        value={current.model}
        onChange={(e) => {
          onChange({ ...current, model: e.target.value });
        }}
      >
        <option value="default">Default</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <select
        className={styles.taskSelect}
        aria-label={`Effort for ${task.label}`}
        value={current.effort}
        onChange={(e) => {
          onChange({ ...current, effort: e.target.value as TaskEffort });
        }}
      >
        <option value="default">Default</option>
        {EFFORTS.map((effort) => {
          const why = unsupported(models, resolved.model, effort);
          return (
            <option key={effort} value={effort} disabled={why !== null} title={why ?? undefined}>
              {effort}
            </option>
          );
        })}
      </select>
    </div>
  );
}
