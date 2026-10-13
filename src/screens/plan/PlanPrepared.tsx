import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { pathFor } from '../../app/routes';
import { Button } from '../../components/Button';
import { useSessionMr } from '../../ipc/hooks/useSources';
import { StubScreen } from '../StubScreen';
import { MrMetaLine } from './MrMetaLine';
import { PlanHeader } from './PlanHeader';
import styles from './Plan.module.css';

export interface PlanPreparedProps {
  sessionId: string;
}

/** Enter outside controls and fields starts step 1 (F-06.11). */
function isTypingOrControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a, input, textarea, select') !== null;
}

/**
 * S-02 in M2 (M2 decision 2): the header, a plan placeholder until M3, Browse files instead
 * (S-06 MR browse, F-24.1) and Start step 1 (the S-03 stub). Sessions without an MR (self-review)
 * keep the stub until M3.
 */
export function PlanPrepared({ sessionId }: PlanPreparedProps) {
  const navigate = useNavigate();
  const session = useSessionMr(sessionId);
  const ready = Boolean(session.data);

  useEffect(() => {
    if (!ready) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented || isTypingOrControl(event.target))
        return;
      if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      event.preventDefault();
      void navigate(pathFor({ screen: 'S-03', sessionId }));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [ready, navigate, sessionId]);

  if (session.isPending) return <div className={styles.screen} aria-busy="true" />;
  if (session.error) {
    return (
      <div className={styles.centered} role="alert">
        {session.error.message}
      </div>
    );
  }
  if (!session.data) return <StubScreen name="Review plan" />;
  const data = session.data;
  return (
    <div className={styles.screen}>
      <div className={styles.page}>
        <PlanHeader
          title={data.mr.title}
          meta={<MrMetaLine session={data} />}
          actions={
            <>
              <Button
                size={46}
                className={styles.secondary}
                onClick={() => void navigate(pathFor({ screen: 'S-06', sessionId }))}
              >
                Browse files instead
              </Button>
              <Button
                variant="primary"
                size={46}
                onClick={() => void navigate(pathFor({ screen: 'S-03', sessionId }))}
              >
                Start step 1 <span className={styles.enter}>↵</span>
              </Button>
            </>
          }
        />
        <section className={styles.region} aria-label="Review plan">
          <p className={styles.placeholder}>
            The review plan comes with M3. Browse files instead to read the change.
          </p>
        </section>
      </div>
    </div>
  );
}
