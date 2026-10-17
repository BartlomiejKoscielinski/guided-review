import { cx } from '../../components/cx';
import { SpinnerIcon } from '../../components/icons';
import styles from './Publish.module.css';

export interface PublishBarProps {
  /** The ticked drafts not published yet. */
  count: number;
  /** No draft waits and the ticked summary comment does (M5 decision 7). */
  summaryOnly: boolean;
  /** Nothing ticked waits and something went out. */
  done: boolean;
  pending: boolean;
  onPublish: () => void;
}

/**
 * Publish (N) next to the tabs on the Drafts tab of S-05 (F-12.5, SummaryDesk.dc.html): blue while
 * there is something to send, "Publish summary" when only the summary comment waits (M5 decision
 * 7), "Published" on the grey fill once everything ticked went out. While the call runs it keeps
 * its name, shows a spinner and can't be pressed again.
 */
export function PublishBar({ count, summaryOnly, done, pending, onPublish }: PublishBarProps) {
  const name = summaryOnly ? 'Publish summary' : `Publish (${String(count)})`;
  return (
    <button
      type="button"
      className={cx(styles.publish, pending && styles.busy)}
      disabled={pending || (count === 0 && !summaryOnly)}
      aria-busy={pending}
      onClick={onPublish}
    >
      {pending && <SpinnerIcon className={styles.spinner} />}
      {done && !pending ? 'Published' : name}
    </button>
  );
}
