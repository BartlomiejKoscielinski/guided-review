import type { Ref } from 'react';
import { Link, useNavigate } from 'react-router';
import { usePreviousScreen } from '../../app/PreviousScreen';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { ChevronLeftIcon, PlayIcon } from '../../components/icons';
import type { PipelineHead } from '../../ipc/types/PipelineHead';
import { allowedLabel, metaText, STATUS_WORD } from './pipelineText';
import styles from './Pipeline.module.css';

export interface PipelineHeaderProps {
  /** The selected pipeline's head; none while it loads, failed or the MR has no pipeline. */
  head: PipelineHead | undefined;
  id: string;
  /** Opens Run new pipeline's confirmation (F-20.3). */
  onRun: () => void;
  /** GitLab is starting the confirmed run: the button is busy and sends nothing more. */
  running: boolean;
  /** No project or a restored start: there is nothing to run the pipeline of yet. */
  runDisabled?: boolean;
  runRef?: Ref<HTMLButtonElement>;
}

/**
 * S-08's head (Pipeline.dc.html): the back link (M6 decision 4), "PIPELINE" with the status block
 * and the allowed-failure tag, the meta line, and Run new pipeline (F-20.1, F-20.3).
 */
export function PipelineHeader({
  head,
  id,
  onRun,
  running,
  runDisabled = false,
  runRef,
}: PipelineHeaderProps) {
  const navigate = useNavigate();
  const previous = usePreviousScreen();
  // Decision 4: "Back to MRs" from S-01, "Back to review" otherwise; both go back in history.
  // A start with no screen before it has no history to go back to and opens S-01.
  const fromList = previous === 'S-01';

  return (
    <section id={id} className={styles.header}>
      <div className={styles.headLeft}>
        <Link
          to="/"
          className={styles.back}
          onClick={(event) => {
            if (previous === null) return;
            event.preventDefault();
            void navigate(-1);
          }}
        >
          <ChevronLeftIcon size={12} strokeWidth={2.4} />
          {fromList ? 'Back to MRs' : 'Back to review'}
        </Link>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Pipeline</h1>
          {head && (
            <span
              data-testid="pipeline-status"
              className={cx(styles.status, styles[`status-${head.status}`])}
            >
              {STATUS_WORD[head.status]}
            </span>
          )}
          {head && head.allowedFailures > 0 && (
            <span data-testid="pipeline-allowed" className={styles.allowed}>
              {allowedLabel(head.allowedFailures)}
            </span>
          )}
        </div>
        {head && (
          <p data-testid="pipeline-meta" className={styles.meta}>
            <span className={styles.metaNum}>#{head.number}</span>
            <span>{head.kind}</span>
            <span className={styles.metaSha}>{head.sha.slice(0, 7)}</span>
            <span>{metaText(head)}</span>
          </p>
        )}
      </div>
      <div className={styles.actions}>
        {/* Opens the confirmation strip and runs the MR's pipeline (F-20.3). */}
        <Button
          ref={runRef}
          variant="primary"
          size={40}
          disabled={running || runDisabled}
          aria-busy={running}
          onClick={onRun}
        >
          <PlayIcon size={13} />
          Run new pipeline
        </Button>
      </div>
    </section>
  );
}
