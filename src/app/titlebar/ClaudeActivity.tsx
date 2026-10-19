import { SpinnerIcon } from '../../components/icons';
import { useClaudeActivity } from '../../ipc/hooks/useClaude';
import styles from './ClaudeActivity.module.css';

/** "Claude is working: N running, M waiting." (", M waiting" only when tasks wait). */
function activityLabel(running: number, waiting: number): string {
  return waiting > 0
    ? `Claude is working: ${String(running)} running, ${String(waiting)} waiting.`
    : `Claude is working: ${String(running)} running.`;
}

/** F-18.8: a spinner while Claude tasks run or wait in the queue; nothing when it is empty. */
export function ClaudeActivity() {
  const activity = useClaudeActivity();
  const running = activity.data?.running ?? 0;
  const waiting = activity.data?.waiting ?? 0;
  if (running === 0 && waiting === 0) return null;
  const label = activityLabel(running, waiting);
  return (
    <span role="status" aria-label={label} title={label} className={styles.activity}>
      <SpinnerIcon className={styles.spinner} />
    </span>
  );
}
