import type { Coverage as CoverageData } from '../../ipc/types/Coverage';
import styles from './PlanAside.module.css';

export interface CoverageProps {
  coverage: CoverageData;
}

const percent = (part: number, total: number) =>
  total > 0 ? Math.min(100, (part / total) * 100) : 100;

/**
 * Aside "Coverage" (F-06.10): `N/N files · N/N hunks` with a bar. The core puts hunks Claude
 * missed into an "Other" step, so the bar is full.
 */
export function Coverage({ coverage }: CoverageProps) {
  const { files, filesTotal, hunks, hunksTotal } = coverage;
  return (
    <section className={styles.card} aria-labelledby="coverage-heading">
      <div className={styles.coverageHead}>
        <h2 id="coverage-heading" className={styles.heading}>
          Coverage
        </h2>
        <span className={styles.coverageNumbers}>
          {files}/{filesTotal} files · {hunks}/{hunksTotal} hunks
        </span>
      </div>
      <span className={styles.coverageBar} aria-hidden="true">
        <span style={{ width: `${String(percent(hunks, hunksTotal))}%` }} />
      </span>
      <span className={styles.note}>
        The plan can change the order but can't skip anything. If Claude misses a hunk, the app adds
        it to an “Other” step.
      </span>
    </section>
  );
}
