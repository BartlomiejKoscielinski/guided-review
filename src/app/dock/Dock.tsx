import { useNavigate } from 'react-router';
import { CommitIcon, MergeRequestIcon, ReviewIcon, SettingsIcon } from '../../components/icons';
import { useUnfinishedSessions } from '../../ipc/hooks/useUnfinishedSessions';
import type { Route } from '../../ipc/types/Route';
import { pathFor, SETTINGS_ROUTE, type DockArea } from '../routes';
import { DockTile } from './DockTile';
import styles from './Dock.module.css';

export const NO_REVIEW_TOOLTIP = 'No review open. Pick one in MRs.';

export interface DockProps {
  /** Area of the current screen. */
  active: DockArea;
}

/**
 * The 72px dock (F-30.2): MRs, Review, Changes, and Settings pinned to the bottom. Review opens
 * the most recent unfinished session at its last screen and is dimmed while there is none.
 */
export function Dock({ active }: DockProps) {
  const navigate = useNavigate();
  const sessions = useUnfinishedSessions();
  const resume = sessions.data?.[0]?.resume;
  const go = (route: Route) => () => {
    void navigate(pathFor(route));
  };

  return (
    <nav aria-label="App" className={styles.dock}>
      <DockTile
        area="mrs"
        label="MRs"
        icon={<MergeRequestIcon />}
        active={active === 'mrs'}
        onSelect={go({ screen: 'S-01' })}
      />
      <DockTile
        area="review"
        label="Review"
        icon={<ReviewIcon />}
        active={active === 'review'}
        dimmedReason={resume ? undefined : NO_REVIEW_TOOLTIP}
        onSelect={resume ? go(resume) : () => undefined}
      />
      <DockTile
        area="changes"
        label="Changes"
        icon={<CommitIcon />}
        active={active === 'changes'}
        onSelect={go({ screen: 'S-06' })}
      />
      <DockTile
        area="settings"
        label="Settings"
        icon={<SettingsIcon />}
        active={active === 'settings'}
        title="Settings · Ctrl+,"
        onSelect={go(SETTINGS_ROUTE)}
      />
    </nav>
  );
}
