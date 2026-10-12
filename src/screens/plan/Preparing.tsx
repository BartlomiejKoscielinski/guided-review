import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { pathFor } from '../../app/routes';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { useCancelPreparation } from '../../ipc/hooks/useSources';
import { useStartStore } from '../../state/start';
import { PlanHeader } from './PlanHeader';
import { stageLines } from './stages';
import styles from './Plan.module.css';

/**
 * S-02 Preparing (F-05.6): the MR title as the heading, the preparation stages in the plan area
 * and Cancel. Opens the plan when the preparation is done; a failure stays here with its message
 * and Back to start. Without a preparation (cancelled, cleared) it goes back to S-01.
 */
export function Preparing() {
  const navigate = useNavigate();
  const preparing = useStartStore((s) => s.preparing);
  const prepareCleared = useStartStore((s) => s.prepareCleared);
  const cancel = useCancelPreparation();
  const outcome = preparing?.outcome ?? null;

  useEffect(() => {
    if (!preparing) void navigate(pathFor({ screen: 'S-01' }), { replace: true });
    else if (outcome?.kind === 'opened') void navigate(pathFor(outcome.route), { replace: true });
  }, [preparing, outcome, navigate]);

  if (!preparing) return <div className={styles.screen} />;
  const failed = outcome?.kind === 'failed' ? outcome.message : null;
  const action = failed ? (
    <Button
      size={46}
      className={styles.secondary}
      onClick={() => {
        prepareCleared(preparing.task);
      }}
    >
      Back to start
    </Button>
  ) : (
    <Button
      size={46}
      className={styles.secondary}
      onClick={() => {
        cancel(preparing.task);
      }}
    >
      Cancel
    </Button>
  );
  return (
    <div className={styles.screen}>
      <div className={styles.page}>
        <PlanHeader title={preparing.title ?? `!${String(preparing.iid)}`} actions={action} />
        <section className={styles.region} aria-label="Preparation" aria-busy={!failed}>
          <ol className={styles.stages}>
            {stageLines(preparing).map((line) => (
              <li key={line.label} className={cx(styles.stage, styles[line.state])}>
                <span className={styles.stageMark} aria-hidden="true" />
                {line.label}
              </li>
            ))}
          </ol>
          {failed && (
            <p className={styles.failure} role="alert">
              {failed}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
