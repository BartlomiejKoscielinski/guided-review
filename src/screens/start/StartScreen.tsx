import { MergeRequests } from './MergeRequests';
import { SourceHero } from './SourceHero';
import styles from './Start.module.css';

/**
 * S-01 Start (docs/02 › S-01): the source input and the Merge requests column. Resume cards
 * come with sessions (F-04, M3); Commits and My changes with 2f (F-03).
 */
export function StartScreen() {
  return (
    <div className={styles.page}>
      <SourceHero />
      <div className={styles.columns}>
        <MergeRequests />
      </div>
    </div>
  );
}
