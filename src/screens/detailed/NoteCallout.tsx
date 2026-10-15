import { useId } from 'react';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { Kbd } from '../../components/Kbd';
import { Tag } from '../../components/Tag';
import type { Evidence } from '../../ipc/types/Evidence';
import type { Finding } from '../../ipc/types/Finding';
import { ClaudeLabel } from '../step/ClaudeLabel';
import { DISMISSED, SEVERITY_TAG, decisionCopy } from '../step/noteCopy';
import { useNoteDecision } from '../step/useNoteDecision';
import styles from './NoteCallout.module.css';

export interface NoteCalloutProps {
  finding: Finding;
  sessionId: string;
  /** The note's number in the step, as on its mark and in the Guide aside. */
  number: number;
  /**
   * Self-review: Keep to fix and Edit and keep (M4 decision 12); undefined while the session is
   * looked up, so no action is offered yet.
   */
  selfReview: boolean | undefined;
  /** Ask Claude: the screen opens the answer about the note's line (F-10.1). */
  onAsk?: (finding: Finding) => void;
}

/** A "Checked in" chip: the last folder, the file name and the line (Main.dc.html). */
function evidenceLabel(evidence: Evidence): string {
  const parts = evidence.file.split(/[\\/]/).filter((p) => p !== '');
  return `${parts.slice(-2).join('/')}:${String(evidence.line)}`;
}

/** The number badge: severity colour, yellow once drafted, an outline once dismissed. */
function badgeClass(finding: Finding): string | undefined {
  return styles[finding.decision === 'open' ? finding.severity : finding.decision];
}

/**
 * S-04's full note callout under the focused note's line (F-08.6, Main.dc.html): number, severity
 * tag, title, Claude label, body, the "Checked in" evidence chips (full path and Claude's note as
 * the tooltip), the "Suggested comment" block and Add to drafts (D), Edit and add, Ask Claude,
 * Dismiss (X). A decided note shows its confirmation and Undo (F-09.3). The decision logic is S-03
 * note card's (`useNoteDecision`); decisions stay on this PC.
 */
export function NoteCallout({ finding, sessionId, number, selfReview, onAsk }: NoteCalloutProps) {
  const {
    open,
    editing,
    pending,
    error,
    text,
    setText,
    addRef,
    undoRef,
    textareaRef,
    startEdit,
    cancelEdit,
    add,
    addEdited,
    dismiss,
    undo,
  } = useNoteDecision(finding, sessionId);
  const textId = useId();
  const tag = SEVERITY_TAG[finding.severity];
  const copy = selfReview === undefined ? null : decisionCopy(selfReview);

  return (
    <div role="region" aria-label="Claude note at this line" className={styles.callout}>
      <div className={styles.head}>
        <span className={cx(styles.badge, badgeClass(finding))}>{String(number)}</span>
        <Tag color={tag.color}>{tag.label}</Tag>
        <span className={styles.title}>{finding.title}</span>
        <ClaudeLabel />
      </div>
      <p className={styles.body}>{finding.body}</p>

      {finding.evidence.length > 0 && (
        <div className={styles.evidence}>
          <span>Checked in</span>
          {finding.evidence.map((evidence, i) => (
            <span
              key={`${evidence.file}:${String(evidence.line)}:${String(i)}`}
              className={styles.chip}
              title={`${evidence.file}:${String(evidence.line)} · ${evidence.note}`}
            >
              {evidenceLabel(evidence)}
            </span>
          ))}
        </div>
      )}

      {copy && open && editing ? (
        <form
          className={styles.editor}
          onSubmit={(event) => {
            event.preventDefault();
            addEdited();
          }}
        >
          <div className={styles.suggestion}>
            <label htmlFor={textId} className={styles.suggestionLabel}>
              Suggested comment
            </label>
            <textarea
              ref={textareaRef}
              id={textId}
              className={styles.textarea}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </div>
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={text.trim() === '' || pending}>
              {copy.add}
            </Button>
            <Button variant="ghost" onClick={cancelEdit}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.suggestion}>
          <div className={styles.suggestionLabel}>Suggested comment</div>
          <div className={styles.suggestionText}>{finding.suggestedComment}</div>
        </div>
      )}

      {copy && open && !editing && (
        <div className={styles.actions}>
          <Button ref={addRef} variant="primary" disabled={pending} onClick={add}>
            {copy.add} <Kbd>D</Kbd>
          </Button>
          <Button disabled={pending} onClick={startEdit}>
            {copy.editAndAdd}
          </Button>
          {onAsk && (
            <Button
              variant="claude"
              onClick={() => {
                onAsk(finding);
              }}
            >
              Ask Claude
            </Button>
          )}
          <Button variant="ghost" disabled={pending} onClick={dismiss}>
            Dismiss <Kbd>X</Kbd>
          </Button>
        </div>
      )}

      {copy && !open && (
        <div
          className={cx(styles.status, finding.decision === 'dismissed' && styles.statusDismissed)}
        >
          <span>{finding.decision === 'draft' ? copy.added : DISMISSED}</span>
          <Button ref={undoRef} size={30} disabled={pending} onClick={undo}>
            Undo
          </Button>
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}
