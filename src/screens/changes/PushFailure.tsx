import type { IpcError } from '../../ipc/errors';
import styles from './Changes.module.css';

export interface PushFailureProps {
  error: IpcError;
  onOpenRider: () => void;
}

/** A rejected or failed push; the app never rebases or forces (02 › S-06, T8). */
export function PushFailure({ error, onOpenRider }: PushFailureProps) {
  return (
    <div role="alert" className={styles.failure}>
      <span>{error.message}</span>
      {error.code === 'CONFLICT' && (
        <button type="button" className={styles.linkButton} onClick={onOpenRider}>
          Pull with rebase in Rider
        </button>
      )}
    </div>
  );
}
