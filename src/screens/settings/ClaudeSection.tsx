import { cx } from '../../components/cx';
import { Segmented } from '../../components/Segmented';
import { useClaudeModels } from '../../ipc/hooks/useClaude';
import { useSettings, useUpdateSettings } from '../../ipc/hooks/useSettings';
import type { Effort } from '../../ipc/types/Effort';
import type { Lang } from '../../ipc/types/Lang';
import { ClaudeCodeRows } from './ClaudeCodeRows';
import { ClaudeStatusLine } from './ClaudeStatusLine';
import { EFFORTS, unsupported } from './efforts';
import { TaskRow } from './TaskRow';
import { TASKS } from './tasks';
import styles from './Settings.module.css';

/** Settings › Claude (F-18.1–F-18.7, Settings.dc.html). Changes save immediately. */
export function ClaudeSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const models = useClaudeModels().data ?? [];
  const data = settings.data;
  if (!data) return null;
  const claude = data.claude;
  const defaultModel = claude.model === 'inherit' ? null : claude.model;
  return (
    <div className={styles.content}>
      <section className={styles.titleBlock}>
        <h1 className={styles.h1}>Claude</h1>
        <ClaudeStatusLine />
      </section>
      <section aria-labelledby="h-default" className={styles.section}>
        <h2 id="h-default" className={cx(styles.h2, styles.h2Tracked)}>
          Defaults
        </h2>
        <div className={styles.grid}>
          <label htmlFor="def-model" className={styles.label}>
            Model
          </label>
          <select
            id="def-model"
            className={styles.select}
            value={claude.model}
            onChange={(e) => {
              update.mutate({ claude: { model: e.target.value } });
            }}
          >
            <option value="inherit">Same as Claude Code</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span id="def-effort-l" className={styles.label}>
            Effort
          </span>
          <Segmented
            label="Effort"
            tone="purple"
            mono
            value={claude.effort}
            onChange={(effort: Effort) => {
              update.mutate({ claude: { effort } });
            }}
            options={EFFORTS.map((effort) => {
              const why = unsupported(models, defaultModel, effort);
              return {
                value: effort,
                label: effort,
                disabled: why !== null,
                title: why ?? undefined,
              };
            })}
          />
          <label htmlFor="def-lang" className={styles.label}>
            Writes in
          </label>
          <div className={styles.inline}>
            <select
              id="def-lang"
              className={styles.select}
              value={claude.lang}
              onChange={(e) => {
                update.mutate({ claude: { lang: e.target.value as Lang } });
              }}
            >
              <option value="en">English</option>
              <option value="pl">Polish</option>
            </select>
            <span className={styles.hint}>
              Notes, suggested comments, commit messages, MR descriptions
            </span>
          </div>
        </div>
      </section>
      <section aria-labelledby="h-tasks" className={styles.sectionTight}>
        <div className={styles.titleBlock} style={{ gap: 2 }}>
          <h2 id="h-tasks" className={cx(styles.h2, styles.h2Tracked)}>
            Per task
          </h2>
          <span className={styles.subtitle}>Overrides the defaults.</span>
        </div>
        <div className={styles.tasks}>
          {TASKS.map((task) => (
            <TaskRow
              key={task.group}
              task={task}
              settings={claude}
              models={models}
              onChange={(override) => {
                update.mutate({ claude: { tasks: { [task.group]: override } } });
              }}
            />
          ))}
        </div>
        <span className={styles.footnote}>
          Passed to <span className={styles.code}>claude -p</span> as{' '}
          <span className={styles.code}>--model</span> and{' '}
          <span className={styles.code}>--effort</span>. Available effort levels depend on the
          model.
        </span>
        <ClaudeCodeRows
          maxConcurrent={claude.maxConcurrent}
          onMaxConcurrent={(maxConcurrent) => {
            update.mutate({ claude: { maxConcurrent } });
          }}
        />
      </section>
      {update.error && (
        <p role="alert" className={styles.error}>
          {update.error.message}
        </p>
      )}
    </div>
  );
}
