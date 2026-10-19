import { useNavigate } from 'react-router';
import { pathFor } from '../../app/routes';
import { Button } from '../../components/Button';
import { Square } from '../../components/Square';
import { cx } from '../../components/cx';
import { useClaudeStatus } from '../../ipc/hooks/useClaude';
import type { JobExplain } from '../../ipc/hooks/useJobExplain';
import { useUnfinishedSessions } from '../../ipc/hooks/useUnfinishedSessions';
import type { JobExplanation } from '../../ipc/types/JobExplanation';
import styles from './ExplainFailure.module.css';

export interface ExplainFailureProps {
  iid: number;
  /** The job's run and answer (`useJobExplain`, held by the job details panel). */
  explain: JobExplain;
  /** A `pipeline #N` chip selects that pipeline's tab. */
  onSelectPipeline: (number: number) => void;
}

/** Decision 14's tag word. */
export function verdictLabel(e: JobExplanation): string {
  switch (e.verdict) {
    case 'causedByMr':
      return 'Caused by this MR';
    case 'alreadyFixed':
      return e.fixedInVersion === undefined
        ? 'Already fixed'
        : `Already fixed in version ${String(e.fixedInVersion)}`;
    case 'unrelated':
      return 'Unrelated';
    case 'flaky':
      return 'Flaky';
    case 'unknown':
      return 'Unknown';
  }
}

const PIPELINE_CHIP = /^pipeline #(\d+)$/i;

/**
 * "Why it failed" of a failed job on S-08 (F-20.7, M6 decisions 12 and 14): before a run the hint
 * and **Explain failure** with Claude's purple square (disabled with "Claude isn't available" when
 * Claude can't run); Claude runs only on that click. While it runs "Preparing the code…" and then
 * "Reading the log and the diff…"; the answer shows the verdict tag, title, explanation, "A retry
 * may help." when Claude recommends one, the evidence chips (`pipeline #N` selects its tab; a
 * `file:line` opens the MR's latest review session when one exists, else plain text) and, with a
 * suggested comment, **Add to drafts**, which turns into the confirmation. A failed run shows
 * "Couldn't explain this failure." with **Retry**. Nothing is posted.
 */
export function ExplainFailure({ iid, explain: ex, onSelectPipeline }: ExplainFailureProps) {
  const status = useClaudeStatus();
  const sessions = useUnfinishedSessions();
  const navigate = useNavigate();
  const state = status.data?.state;
  const unusable = state !== undefined && state !== 'signedIn' && state !== 'checking';
  const session = sessions.data?.find((s) => s.source.kind === 'mr' && s.source.iid === iid);

  const chip = (item: string) => {
    const pipeline = PIPELINE_CHIP.exec(item);
    if (pipeline?.[1] !== undefined) {
      const number = Number(pipeline[1]);
      return (
        <button
          key={item}
          type="button"
          className={cx(styles.chip, styles.link)}
          onClick={() => {
            onSelectPipeline(number);
          }}
        >
          {item}
        </button>
      );
    }
    if (session) {
      return (
        <button
          key={item}
          type="button"
          className={cx(styles.chip, styles.link)}
          title="Open in the review session"
          onClick={() => {
            void navigate(pathFor(session.resume));
          }}
        >
          {item}
        </button>
      );
    }
    return (
      <span key={item} className={styles.chip}>
        {item}
      </span>
    );
  };

  return (
    <div className={styles.why}>
      <h3 className={styles.heading}>
        <Square color="purple" size={14} />
        Why it failed
      </h3>
      {ex.running ? (
        <span role="status" className={styles.running}>
          <svg
            className={styles.spinner}
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="square"
            aria-hidden="true"
          >
            <path d="M8 2a6 6 0 1 1-6 6" />
          </svg>
          {ex.preparing ? 'Preparing the code…' : 'Reading the log and the diff…'}
        </span>
      ) : ex.result ? (
        <div className={styles.result}>
          <span
            data-testid="explain-verdict"
            className={cx(styles.verdict, styles[ex.result.verdict])}
          >
            {verdictLabel(ex.result)}
          </span>
          <span className={styles.title}>{ex.result.title}</span>
          <p className={styles.body}>{ex.result.explanation}</p>
          {ex.result.retryRecommended && <p className={styles.body}>A retry may help.</p>}
          {ex.result.evidence.length > 0 && (
            <div className={styles.chips}>{ex.result.evidence.map(chip)}</div>
          )}
          {ex.result.suggestedComment !== '' && (
            <div className={styles.comment}>
              <span className={styles.label}>Suggested comment</span>
              <span className={styles.commentText}>{ex.result.suggestedComment}</span>
              {ex.drafted ? (
                <span className={styles.drafted}>
                  <Square color="yellow" size={9} />
                  In drafts. Publish it with the rest from Summary.
                </span>
              ) : (
                <Button
                  variant="primary"
                  size={34}
                  className={styles.add}
                  disabled={ex.drafting}
                  onClick={ex.addToDrafts}
                >
                  Add to drafts
                </Button>
              )}
              {ex.draftError !== null && (
                <p role="alert" className={styles.error}>
                  {`Couldn't add it to the drafts. ${ex.draftError}`}
                </p>
              )}
            </div>
          )}
        </div>
      ) : ex.failed ? (
        <div className={styles.idle}>
          <p role="alert" className={styles.error}>
            Couldn&apos;t explain this failure.
          </p>
          <Button size={34} disabled={unusable} onClick={ex.explain}>
            Retry
          </Button>
        </div>
      ) : (
        <div className={styles.idle}>
          <span className={styles.hint}>
            Claude reads this log and the MR diff. Nothing is posted.
          </span>
          <Button
            size={38}
            disabled={unusable}
            title={unusable ? "Claude isn't available" : undefined}
            onClick={ex.explain}
          >
            <Square color="purple" size={10} />
            Explain failure
          </Button>
        </div>
      )}
    </div>
  );
}
