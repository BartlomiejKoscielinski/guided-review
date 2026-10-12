import { Button } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import { useClaudeStatus, usePickClaude } from '../../ipc/hooks/useClaude';
import styles from './Settings.module.css';

const LIMITS = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
] as const;

export interface ClaudeCodeRowsProps {
  maxConcurrent: number;
  onMaxConcurrent: (max: number) => void;
}

/**
 * Rows the mock doesn't show (02 › S-07, F-18.6): the executable the app uses (path ·
 * version, Change) and "Run at most N Claude tasks at once".
 */
export function ClaudeCodeRows({ maxConcurrent, onMaxConcurrent }: ClaudeCodeRowsProps) {
  const status = useClaudeStatus();
  const pick = usePickClaude();
  const data = status.data;
  return (
    <div className={styles.grid}>
      <span className={styles.label}>Claude Code</span>
      <div className={styles.inline}>
        <span className={styles.path}>
          {data?.path ?? 'Not found'}
          {data?.version ? ` · ${data.version}` : ''}
        </span>
        <Button
          size={30}
          disabled={pick.isPending}
          onClick={() => {
            pick.mutate(undefined);
          }}
        >
          Change
        </Button>
        {pick.error && <span className={styles.error}>{pick.error.message}</span>}
      </div>
      <span className={styles.label} id="max-concurrent">
        Run at most
      </span>
      <div className={styles.inline}>
        <Segmented
          label="Run at most N Claude tasks at once"
          tone="purple"
          mono
          options={LIMITS}
          value={String(maxConcurrent) as (typeof LIMITS)[number]['value']}
          onChange={(v) => {
            onMaxConcurrent(Number(v));
          }}
        />
        <span className={styles.hint}>Claude tasks at once</span>
      </div>
    </div>
  );
}
