import type { Plan } from '../../ipc/types/Plan';
import { Claims } from './Claims';
import { Coverage } from './Coverage';
import { Risks } from './Risks';
import styles from './PlanAside.module.css';

export interface PlanAsideProps {
  plan: Plan;
  /** A step's number in the reader's order (1-based); 0 when unknown. */
  position: (stepId: string) => number;
  /** The claims card's heading; an MR's by default (F-17.1 commits: "Commit messages vs code"). */
  claimsHeading?: string;
}

/**
 * S-02 aside (F-06.7–F-06.10): Risks to check, MR description vs code, Already discussed,
 * Coverage. Empty sections are left out (the fallback plan has no claims).
 */
export function PlanAside({
  plan,
  position,
  claimsHeading = 'MR description vs code',
}: PlanAsideProps) {
  return (
    <aside className={styles.aside} aria-label="Plan details">
      {plan.risks.length > 0 && <Risks risks={plan.risks} position={position} />}
      {plan.descriptionCheck.length > 0 && (
        <Claims claims={plan.descriptionCheck} position={position} heading={claimsHeading} />
      )}
      {plan.alreadyDiscussed !== '' && (
        <section className={styles.card} aria-labelledby="discussed-heading">
          <h2 id="discussed-heading" className={styles.heading}>
            Already discussed
          </h2>
          <span className={styles.text}>{plan.alreadyDiscussed}</span>
        </section>
      )}
      <Coverage coverage={plan.coverage} />
    </aside>
  );
}
