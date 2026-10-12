import type { IpcError } from '../../ipc/errors';
import styles from './Changes.module.css';

export interface CommitFailureProps {
  error: IpcError;
}

/** A failed commit: the message stays; a hook's output is in a collapsible block (02 › S-06). */
export function CommitFailure({ error }: CommitFailureProps) {
  return (
    <div role="alert" className={styles.failure}>
      <span>{error.message}</span>
      {error.detail && (
        <details>
          <summary>Hook output</summary>
          <pre>{error.detail}</pre>
        </details>
      )}
    </div>
  );
}
