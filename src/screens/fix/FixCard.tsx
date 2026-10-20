import { Button } from '../../components/Button';
import { LockIcon, SpinnerIcon } from '../../components/icons';
import { DiffView } from '../../diff/DiffView';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { FixProposal } from '../../ipc/types/FixProposal';
import { fileName, type FixCardState } from './fixState';
import styles from './FixCard.module.css';

export interface FixCardProps {
  state: FixCardState;
  /** Accept writes the change into the working copy (F-25.4). */
  onAccept: () => void;
  /** Discard drops the proposal (F-25.4). */
  onDiscard: () => void;
  /** Cancel stops Claude while it works. */
  onCancel: () => void;
  /** Close dismisses a failed run or a run that changed nothing. */
  onClose: () => void;
}

/** The proposal's one file as a diff for `DiffView`. */
function diffOf(proposal: FixProposal): FileDiff {
  const lines = proposal.hunks.flatMap((h) => h.lines);
  return {
    newPath: proposal.file,
    status: 'modified',
    binary: false,
    additions: lines.filter((l) => l.kind === 'add').length,
    deletions: lines.filter((l) => l.kind === 'del').length,
    layer: 'other',
    hunks: proposal.hunks,
    lineStaging: false,
  };
}

/**
 * The fix card shared by S-05 and S-10 (F-25.3, Author.dc.html `fBusy` and `fProposed`): the busy
 * line "Claude is editing <name>…" with Cancel; the proposal "Proposed change · Edited 1 file:
 * <name>" with the diff of that file, Claude's sentence, Accept (green) and Discard; "Claude made
 * no change." with the sentence and Close (M7 decision 3); a failed run's message with Close.
 */
export function FixCard({ state, onAccept, onDiscard, onCancel, onClose }: FixCardProps) {
  if (state.phase === 'running') {
    return (
      <div className={styles.busyRow}>
        <span role="status" className={styles.busy}>
          <SpinnerIcon className={styles.spinner} />
          {`Claude is editing ${fileName(state.file)}…`}
        </span>
        <Button variant="ghost" size={30} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }
  if (state.phase === 'failed') {
    return (
      <div className={styles.card}>
        <p role="alert" className={styles.error}>
          <span>{state.message}</span>
        </p>
        <div className={styles.actions}>
          <Button size={36} onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }
  const { proposal } = state;
  if (proposal.hunks.length === 0) {
    return (
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.mark} />
          <span className={styles.title}>Claude made no change.</span>
        </div>
        <p className={styles.sentence}>{proposal.explanation}</p>
        <div className={styles.actions}>
          <Button size={36} onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.mark} />
        <span className={styles.title}>Proposed change</span>
        <span className={styles.file}>
          <LockIcon className={styles.lock} />
          {`Edited 1 file: ${fileName(proposal.file)}`}
        </span>
      </div>
      <div className={styles.diff}>
        <DiffView
          path={proposal.file}
          diff={diffOf(proposal)}
          layout="unified"
          headers={false}
          virtual={false}
        />
      </div>
      <p className={styles.sentence}>{proposal.explanation}</p>
      <div className={styles.actions}>
        <Button variant="approve" size={36} onClick={onAccept}>
          Accept
        </Button>
        <Button size={36} onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  );
}
