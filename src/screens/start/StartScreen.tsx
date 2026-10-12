import { Commits } from './Commits';
import { MergeRequests } from './MergeRequests';
import { MyChanges } from './MyChanges';
import { SourceHero } from './SourceHero';
import styles from './Start.module.css';

/**
 * S-01 Start (docs/02 › S-01): the source input and the three columns. Resume cards come with
 * sessions (F-04, M3).
 */
export function StartScreen() {
  return (
    <div className={styles.page}>
      <SourceHero />
      <div className={styles.columns}>
        <MergeRequests />
        <Commits />
        <MyChanges />
      </div>
    </div>
  );
}
