import { useId } from 'react';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { SpinnerIcon } from '../../components/icons';
import { Square } from '../../components/Square';
import type { SummaryComment } from './useSummaryComment';
import styles from './Summary.module.css';

export interface SummaryCommentFieldProps {
  comment: SummaryComment;
}

/**
 * "Add a summary comment" under the drafts of S-05 (F-12.4, SummaryDesk.dc.html, M5 decision 11):
 * the blue tick reveals the text area. Above it "Claude is writing a summary…" while the task
 * runs (the area stays editable), "Suggested by Claude, edit as you like" once Claude's words are
 * in it, or "Couldn't suggest a summary." with Retry; no label when the words are the reviewer's
 * own or Claude can't be used.
 */
export function SummaryCommentField({ comment }: SummaryCommentFieldProps) {
  const id = useId();
  const { field, phase } = comment;
  const nameId = `${id}-name`;
  const areaId = `${id}-area`;
  const failId = `${id}-failed`;

  if (!field) {
    return comment.error ? (
      <p role="alert" className={styles.draftError}>
        {comment.error}
      </p>
    ) : null;
  }

  const labelled =
    phase === 'running' || (phase === 'idle' && field.suggested && field.text !== '');

  return (
    <div className={styles.summaryComment}>
      <Checkbox
        state={field.enabled ? 'on' : 'off'}
        label="Add a summary comment"
        tone="blue"
        className={styles.summaryTick}
        onToggle={comment.toggle}
      >
        <span id={nameId}>Add a summary comment</span>
      </Checkbox>
      {field.enabled && (
        <div className={styles.summaryBody}>
          {phase === 'running' && (
            <label htmlFor={areaId} className={styles.summaryLabel}>
              <SpinnerIcon className={styles.summarySpinner} />
              Claude is writing a summary…
            </label>
          )}
          {labelled && phase === 'idle' && (
            <label htmlFor={areaId} className={styles.summaryLabel}>
              <Square color="purple" />
              Suggested by Claude, edit as you like
            </label>
          )}
          {phase === 'failed' && (
            <div role="alert" className={styles.summaryFailed}>
              <span id={failId}>Couldn't suggest a summary.</span>
              <Button size={30} onClick={comment.retry}>
                Retry
              </Button>
            </div>
          )}
          <textarea
            id={areaId}
            rows={4}
            value={field.text}
            aria-labelledby={labelled ? undefined : nameId}
            aria-describedby={phase === 'failed' ? failId : undefined}
            className={styles.summaryArea}
            onChange={(event) => {
              comment.edit(event.target.value);
            }}
          />
        </div>
      )}
      {comment.error && (
        <p role="alert" className={styles.draftError}>
          {comment.error}
        </p>
      )}
    </div>
  );
}
