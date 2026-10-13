import { cx } from '../../components/cx';
import type { Risk } from '../../ipc/types/Risk';
import { CodeText } from './CodeText';
import { stepRefs } from './planText';
import styles from './PlanAside.module.css';

export interface RisksProps {
  risks: readonly Risk[];
  position: (stepId: string) => number;
}

/**
 * Aside "Risks to check" (F-06.7, F-06.13): the app's configuration risks first, then Claude's,
 * each with its severity square and the steps it points at.
 */
export function Risks({ risks, position }: RisksProps) {
  const ordered = [...risks.filter((r) => r.app), ...risks.filter((r) => !r.app)];
  return (
    <section className={styles.card} aria-labelledby="risks-heading">
      <h2 id="risks-heading" className={styles.heading}>
        Risks to check
      </h2>
      <ul className={styles.risks}>
        {ordered.map((risk) => {
          const refs = stepRefs(risk.steps, position);
          const question = risk.severity === 'q' && !risk.app;
          return (
            <li key={risk.text} className={styles.risk}>
              <span
                className={cx(styles.riskSquare, question ? styles.question : styles.fix)}
                aria-hidden="true"
              />
              <span className={styles.riskText}>
                <span className="visually-hidden">{question ? 'Question: ' : 'Should fix: '}</span>
                <CodeText text={risk.text} />
                {refs && <span className={styles.refs}> {refs}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
