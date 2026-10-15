import { Commits } from './Commits';
import { MergeRequests } from './MergeRequests';
import { MyChanges } from './MyChanges';
import { ResumeCards } from './ResumeCards';
import { SourceHero } from './SourceHero';
import styles from './Start.module.css';

/**
 * S-01 Start (docs/02 › S-01): the source input, "Pick up where you left off" (F-04.1) and the
 * three columns.
 */
export function StartScreen() {
  return (
    <div className={styles.page}>
      <SourceHero />
      <ResumeCards />
      <div className={styles.columns}>
        <MergeRequests />
        <Commits />
        <MyChanges />
      </div>
    </div>
  );
}
