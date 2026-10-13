import { cx } from '../../components/cx';
import type { Claim } from '../../ipc/types/Claim';
import { claimText } from './planText';
import styles from './PlanAside.module.css';

export interface ClaimsProps {
  claims: readonly Claim[];
  position: (stepId: string) => number;
}

function CheckIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d="M3 8.5l3.2 3L13 4.5" />
    </svg>
  );
}

/** Aside "MR description vs code" (F-06.8): ✓ found in step N, or ! missing or contradicted. */
export function Claims({ claims, position }: ClaimsProps) {
  return (
    <section className={styles.card} aria-labelledby="claims-heading">
      <h2 id="claims-heading" className={styles.heading}>
        MR description vs code
      </h2>
      <ul className={styles.claims}>
        {claims.map((claim) => {
          const { text, where } = claimText(claim, claim.step ? position(claim.step) : 0);
          const found = claim.status === 'found';
          return (
            <li key={`${claim.status}:${claim.claim}`} className={styles.claim}>
              <span className={cx(styles.mark, found ? styles.found : styles.issue)}>
                {found ? <CheckIcon /> : <span aria-hidden="true">!</span>}
              </span>
              <span className={styles.claimText}>
                {text}
                {where && <span className={styles.refs}> · {where}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
