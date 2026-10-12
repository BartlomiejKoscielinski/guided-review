import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { Square } from '../../components/Square';
import { usePickRider, useRiderStatus } from '../../ipc/hooks/useRider';
import { useSettings, useUpdateSettings } from '../../ipc/hooks/useSettings';
import type { RiderOpenFrom } from '../../ipc/types/RiderOpenFrom';
import styles from './Settings.module.css';

const OPEN_NOTES: Record<RiderOpenFrom, string> = {
  worktree: 'Your own branch stays untouched.',
  checkout: 'Only when that branch is checked out.',
};

/**
 * Settings › Integrations (Settings.dc.html): JetBrains Rider path and where a teammate's MR
 * opens from (F-24.1, F-24.4). "From Rider to this app" and "Code navigation" come with their
 * milestones.
 */
export function IntegrationsSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const rider = useRiderStatus();
  const pick = usePickRider();
  const openFrom = settings.data?.rider.openFrom;
  const status = rider.data;
  if (!openFrom || !status) return null;
  const found = status.path != null;
  const error = pick.error ?? update.error;
  return (
    <div className={styles.content}>
      <h1 className={styles.h1}>Integrations</h1>
      <section aria-labelledby="h-rider" className={styles.sectionTight}>
        <div className={styles.titleRow}>
          <h2 id="h-rider" className={styles.h2}>
            JetBrains Rider
          </h2>
          <span className={styles.statusSmall} role="status">
            <Square color={found ? 'green' : 'orange'} size={9} />
            {found ? `Found${status.version ? ` ${status.version}` : ''}` : 'Not found'}
          </span>
        </div>
        <div className={cx(styles.grid, styles.gridWide)}>
          <span className={styles.label}>Path</span>
          <span className={styles.inline}>
            <span className={found ? styles.pathSmall : styles.label}>
              {status.path ?? 'Not found'}
            </span>
            <Button
              size={28}
              disabled={pick.isPending}
              onClick={() => {
                pick.mutate(undefined);
              }}
            >
              Change
            </Button>
          </span>
          <label htmlFor="rider-open" className={styles.label}>
            Teammates’ MRs open from
          </label>
          <div className={styles.inline}>
            <select
              id="rider-open"
              className={cx(styles.select, styles.selectNarrow)}
              value={openFrom}
              onChange={(e) => {
                update.mutate({ rider: { openFrom: e.target.value as RiderOpenFrom } });
              }}
            >
              <option value="worktree">The review worktree</option>
              <option value="checkout">My checkout</option>
            </select>
            <span className={styles.hint}>{OPEN_NOTES[openFrom]}</span>
          </div>
          {error && (
            <>
              <span />
              <span role="alert" className={styles.error}>
                {error.message}
              </span>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
