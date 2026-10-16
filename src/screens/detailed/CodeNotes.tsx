import { useId } from 'react';
import { cx } from '../../components/cx';
import { Kbd } from '../../components/Kbd';
import { Tag } from '../../components/Tag';
import type { Finding } from '../../ipc/types/Finding';
import { SEVERITY_TAG } from '../step/noteCopy';
import { StepNotes } from '../step/StepNotes';
import styles from './GuideAside.module.css';

export interface CodeNotesProps {
  sessionId: string;
  stepId: string;
  /** The step's notes in line order (diff order: file, then line). */
  findings: Finding[];
  focused: string | null;
  /** A click on a note focuses it and brings its callout into view. */
  onPick: (findingId: string) => void;
  /** Self-review: a kept note reads "To fix"; undefined while the session is looked up. */
  selfReview: boolean | undefined;
}

/** The status word of a decided note (Main.dc.html); none while the copy is unknown. */
function noteStatus(finding: Finding, selfReview: boolean | undefined): string | null {
  if (finding.decision === 'dismissed') return 'Dismissed';
  if (finding.decision !== 'draft' || selfReview === undefined) return null;
  return selfReview ? 'To fix' : 'In drafts';
}

/**
 * The Guide aside's "Code notes" (F-08.7): the step's notes in line order, each with its number,
 * severity tag, line and title, the focused one marked; `N` moves to the next. Without notes it
 * shows the step's notes state (reading, failed with Retry, nothing stood out).
 */
export function CodeNotes({
  sessionId,
  stepId,
  findings,
  focused,
  onPick,
  selfReview,
}: CodeNotesProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={styles.notes}>
      <div className={styles.sectionHead}>
        <h2 id={headingId} className={styles.heading}>
          Code notes
        </h2>
        <span className={styles.hint}>
          in line order · <Kbd>N</Kbd>
        </span>
      </div>
      {findings.length === 0 && <StepNotes sessionId={sessionId} stepId={stepId} />}
      {findings.map((finding, i) => {
        const on = finding.id === focused;
        const tag = SEVERITY_TAG[finding.severity];
        const status = noteStatus(finding, selfReview);
        const dismissed = finding.decision === 'dismissed';
        return (
          <div
            key={finding.id}
            className={cx(styles.note, on && styles.noteOn, dismissed && styles.noteDismissed)}
          >
            <button
              type="button"
              className={styles.noteButton}
              aria-pressed={on}
              onClick={() => {
                onPick(finding.id);
              }}
            >
              <span
                className={cx(
                  styles.badge,
                  styles[finding.decision === 'open' ? finding.severity : finding.decision],
                )}
              >
                {String(i + 1)}
              </span>
              <span className={styles.noteText}>
                <span className={styles.noteMeta}>
                  <Tag color={tag.color}>{tag.label}</Tag>
                  <span className={styles.line}>{`L${String(finding.line)}`}</span>
                </span>
                <span className={cx(styles.title, dismissed && styles.titleDismissed)}>
                  {finding.title}
                </span>
              </span>
              {status !== null && (
                <span
                  className={cx(styles.status, finding.decision === 'draft' && styles.statusDraft)}
                >
                  {status}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </section>
  );
}
