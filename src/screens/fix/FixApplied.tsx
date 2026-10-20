import { useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { pathFor } from '../../app/routes';
import styles from './FixCard.module.css';

/**
 * After Accept in a self-review (F-25.4, M7 decision 2; Author.dc.html `fApplied`): the green
 * line "Applied to your working copy." with Browse and commit (S-06 local mode), the one place
 * where local changes are committed.
 */
export function FixApplied() {
  const navigate = useNavigate();
  return (
    <div className={styles.appliedRow}>
      <span className={styles.applied}>
        <span className={styles.appliedMark} />
        Applied to your working copy.
      </span>
      <Button
        variant="neutral"
        size={30}
        onClick={() => {
          void navigate(pathFor({ screen: 'S-06' }));
        }}
      >
        Browse and commit
      </Button>
    </div>
  );
}
