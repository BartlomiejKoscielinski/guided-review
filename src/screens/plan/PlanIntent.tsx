import { Square } from '../../components/Square';
import { CodeText } from './CodeText';
import styles from './Plan.module.css';

export interface PlanIntentProps {
  /** Claude's 2–4 sentences; `null` while Claude is planning. */
  intent: string | null;
}

/**
 * "What this change does" (F-06.2): Claude content, marked with the purple square. While Claude
 * plans it shows the calm placeholder (02 › S-02 Planning).
 */
export function PlanIntent({ intent }: PlanIntentProps) {
  return (
    <section
      className={styles.intent}
      aria-labelledby="intent-heading"
      aria-busy={intent === null || undefined}
    >
      <div className={styles.intentHead}>
        <Square color="purple" size={10} />
        <h2 id="intent-heading" className={styles.intentHeading}>
          What this change does
        </h2>
      </div>
      {intent === null ? (
        <p className={styles.placeholder}>Claude is planning · usually under a minute</p>
      ) : (
        <p className={styles.intentText}>
          <CodeText text={intent} />
        </p>
      )}
    </section>
  );
}
