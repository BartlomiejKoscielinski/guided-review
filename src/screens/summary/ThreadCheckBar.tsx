import { useEffect, useRef } from 'react';
import { Button } from '../../components/Button';
import { SpinnerIcon } from '../../components/icons';
import { Square } from '../../components/Square';
import type { ThreadCheck } from './useThreadCheck';
import styles from './Threads.module.css';

export interface ThreadCheckBarProps {
  check: ThreadCheck;
}

/**
 * Check with Claude above the threads of S-05 (F-13.3, M5 decision 12): a neutral button with
 * Claude's purple square, then what the check is doing. While it runs the button waits and
 * "Claude is checking the threads…" stands next to it; an answer naming no thread says so; a
 * failure says "Couldn't check the threads." with Retry. The button stays after an answer, so
 * the reviewer can check again. The lines are announced from a status region (WCAG 4.1.3), and
 * when a run ends with the focus on nothing (the button was disabled under it) the focus goes
 * back to the button, or to Retry after a failure.
 */
export function ThreadCheckBar({ check }: ThreadCheckBarProps) {
  const { phase, hints } = check;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const last = useRef(phase);

  useEffect(() => {
    const ended = last.current === 'running' && phase !== 'running';
    last.current = phase;
    if (!ended) return;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (lost) (phase === 'failed' ? retryRef : buttonRef).current?.focus();
  }, [phase]);

  return (
    <div className={styles.check}>
      <Button ref={buttonRef} size={34} disabled={phase === 'running'} onClick={check.check}>
        <Square color="purple" />
        Check with Claude
      </Button>
      <div role="status" className={styles.checkStatus}>
        {phase === 'running' && (
          <span className={styles.checkLine}>
            <SpinnerIcon className={styles.checkSpinner} />
            Claude is checking the threads…
          </span>
        )}
        {phase === 'idle' && hints?.size === 0 && (
          <span className={styles.checkLine}>
            Claude found no thread addressed by a later commit.
          </span>
        )}
      </div>
      {phase === 'failed' && (
        <div role="alert" className={styles.checkFailed}>
          <span>Couldn't check the threads.</span>
          <Button ref={retryRef} size={30} onClick={check.check}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
