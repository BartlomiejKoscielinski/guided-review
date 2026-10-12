import { Button } from '../../components/Button';
import { usePickRepo } from '../../ipc/hooks/useChanges';
import styles from './Changes.module.css';

/** S-06 without a repository (M1, until F-19.6): a folder dialog picks the default one. */
export function PickRepository() {
  const pick = usePickRepo();
  return (
    <div className={styles.centered}>
      <Button
        variant="primary"
        size={42}
        disabled={pick.isPending}
        onClick={() => {
          pick.mutate();
        }}
      >
        Pick a repository
      </Button>
      {pick.error && <span role="alert">{pick.error.message}</span>}
    </div>
  );
}
