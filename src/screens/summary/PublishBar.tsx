import { cx } from '../../components/cx';
import { SpinnerIcon } from '../../components/icons';
import styles from './Publish.module.css';

export interface PublishBarProps {
  /** The ticked drafts not published yet. */
  count: number;
  /** Nothing ticked waits and something went out. */
  done: boolean;
  pending: boolean;
  onPublish: () => void;
}

/**
 * Publish (N) next to the tabs on the Drafts tab of S-05 (F-12.5, SummaryDesk.dc.html): blue while
 * there is something to send, "Published" on the grey fill once everything ticked went out. While
 * the call runs it keeps its name, shows a spinner and can't be pressed again.
 */
export function PublishBar({ count, done, pending, onPublish }: PublishBarProps) {
  return (
    <button
      type="button"
      className={cx(styles.publish, pending && styles.busy)}
      disabled={pending || count === 0}
      aria-busy={pending}
      onClick={onPublish}
    >
      {pending && <SpinnerIcon className={styles.spinner} />}
      {done && !pending ? 'Published' : `Publish (${String(count)})`}
    </button>
  );
}
