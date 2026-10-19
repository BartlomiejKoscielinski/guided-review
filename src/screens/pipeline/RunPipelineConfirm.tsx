import { useEffect, useRef } from 'react';
import styles from './RunPipelineConfirm.module.css';

export interface RunPipelineConfirmProps {
  /** The MR's full head SHA; null while it is read (Run pipeline waits for it). */
  sha: string | null;
  onRun: () => void;
  onCancel: () => void;
}

/**
 * Run new pipeline's confirmation strip (F-20.3, Pipeline.dc.html): names the 7 characters of the
 * MR's head and what the run does. It opens with the focus on Cancel (the safe button of a write
 * to GitLab); Escape cancels like Cancel.
 */
export function RunPipelineConfirm({ sha, onRun, onCancel }: RunPipelineConfirmProps) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-label="Run new pipeline"
      className={styles.strip}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <span className={styles.question}>
        Run a new merge request pipeline on{' '}
        <span className={styles.sha} aria-busy={sha === null}>
          {sha === null ? '…' : sha.slice(0, 7)}
        </span>
        ?
      </span>
      <span className={styles.promise}>Uses the MR’s latest commit. Manual jobs stay manual.</span>
      <span className={styles.buttons}>
        <button type="button" className={styles.run} disabled={sha === null} onClick={onRun}>
          Run pipeline
        </button>
        <button ref={cancel} type="button" className={styles.cancel} onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  );
}
