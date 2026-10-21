import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { pathFor } from '../../app/routes';
import styles from './FixCard.module.css';

/**
 * After Accept in a self-review (F-25.4, M7 decision 2; Author.dc.html `fApplied`): the green
 * line "Applied to your working copy." with Browse and commit (S-06 local mode), the one place
 * where local changes are committed. The line is a status message; when it replaces the proposal
 * on screen (`focus`) and focus went with the Accept button, focus moves to Browse and commit.
 */
export function FixApplied({ focus = false }: { focus?: boolean }) {
  const navigate = useNavigate();
  const browse = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (focus && (active === null || active === document.body)) browse.current?.focus();
  }, [focus]);
  return (
    <div className={styles.appliedRow}>
      <span role="status" className={styles.applied}>
        <span className={styles.appliedMark} />
        Applied to your working copy.
      </span>
      <Button
        ref={browse}
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
