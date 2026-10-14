import { Button } from '../../components/Button';
import { SpinnerIcon } from '../../components/icons';
import { useStepFindings } from '../../ipc/hooks/useReview';
import type { Finding } from '../../ipc/types/Finding';
import { NoteCard } from './NoteCard';
import { useNotesRequest } from './notesRequest';
import styles from './Notes.module.css';

export interface StepNotesProps {
  sessionId: string;
  stepId: string;
  selfReview?: boolean;
  onAsk?: (finding: Finding) => void;
}

/**
 * A step's notes area (F-09.6): "Claude is reading this step…" while the step task runs (the
 * diff stays usable), "Couldn't analyze this step." with Retry, "Nothing stood out. Read it
 * yourself, though." with no notes, else the note cards in diff order.
 */
export function StepNotes({ sessionId, stepId, selfReview = false, onAsk }: StepNotesProps) {
  const { query } = useStepFindings(sessionId, stepId, useNotesRequest());

  // Not asked for (S-03 restored on start without cached notes): no state to show.
  if (query.data === undefined && query.isPending && query.fetchStatus === 'idle') return null;
  if (query.data === undefined && (query.isPending || query.isFetching)) {
    return (
      <div className={styles.state} role="status">
        <span className={styles.reading}>
          <SpinnerIcon className={styles.spinner} />
          Claude is reading this step…
        </span>
      </div>
    );
  }
  if (query.data === undefined) {
    return (
      <div className={styles.state} role="alert">
        <span>Couldn't analyze this step.</span>
        <Button
          size={30}
          onClick={() => {
            void query.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
  if (query.data.findings.length === 0) {
    return (
      <div className={styles.state} role="status">
        Nothing stood out. Read it yourself, though.
      </div>
    );
  }
  return (
    <div className={styles.notes}>
      {query.data.findings.map((finding) => (
        <NoteCard
          key={finding.id}
          finding={finding}
          sessionId={sessionId}
          selfReview={selfReview}
          onAsk={onAsk}
        />
      ))}
    </div>
  );
}
