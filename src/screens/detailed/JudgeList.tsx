import { useId, useState } from 'react';
import { cx } from '../../components/cx';
import { useSessionState, useSessionStateWriter } from '../../ipc/hooks/useSessionState';
import styles from './GuideAside.module.css';

export interface JudgeListProps {
  sessionId: string;
  stepId: string;
  /** Claude's checks for the step (`StepAnalysis.checklist`), in its order. */
  checklist: string[];
}

/**
 * The Guide aside's "For you to judge" (F-08.7): the step's checks as checkboxes with
 * `ticked/total`; the ticks are kept with the session (`session_set_checklist`, F-04.3).
 */
export function JudgeList({ sessionId, stepId, checklist }: JudgeListProps) {
  const headingId = useId();
  const kept = useSessionState(sessionId).data?.checklist[stepId] ?? [];
  const writer = useSessionStateWriter(sessionId);
  // The ticks follow a click at once: the cached session state re-renders a moment later, and a
  // controlled checkbox would spring back meanwhile.
  const [local, setLocal] = useState<{ stepId: string; ticked: string[] } | null>(null);
  const source = local?.stepId === stepId ? local.ticked : kept;
  const ticked = checklist.filter((item) => source.includes(item));
  const progress = `${String(ticked.length)}/${String(checklist.length)}`;

  const toggle = (item: string) => {
    const on = new Set(ticked);
    if (on.has(item)) on.delete(item);
    else on.add(item);
    const next = checklist.filter((c) => on.has(c));
    setLocal({ stepId, ticked: next });
    writer.setChecklist(stepId, next);
  };

  return (
    <section aria-labelledby={headingId} className={styles.judge}>
      <div className={styles.sectionHead}>
        <h2 id={headingId} className={styles.heading}>
          For you to judge
        </h2>
        <span className={styles.count}>{progress}</span>
      </div>
      {checklist.map((item) => {
        const on = ticked.includes(item);
        return (
          <label key={item} className={styles.check}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={on}
              onChange={() => {
                toggle(item);
              }}
            />
            <span className={cx(styles.checkText, on && styles.checkDone)}>{item}</span>
          </label>
        );
      })}
    </section>
  );
}
