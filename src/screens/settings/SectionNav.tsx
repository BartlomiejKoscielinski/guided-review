import { useNavigate } from 'react-router';
import { pathFor, SETTINGS_SECTIONS } from '../../app/routes';
import type { SettingsSection } from '../../ipc/types/SettingsSection';
import styles from './Settings.module.css';

const LABELS: Record<SettingsSection, string> = {
  general: 'General',
  claude: 'Claude',
  gitlab: 'GitLab',
  integrations: 'Integrations',
  notifications: 'Notifications',
  rules: 'Team rules',
  shortcuts: 'Shortcuts',
};

export interface SectionNavProps {
  current: SettingsSection;
}

/**
 * Settings sections (02 › S-07). The Team rules badge appears when a rule suggestion waits
 * (F-29.2, M10); hidden until then.
 */
export function SectionNav({ current }: SectionNavProps) {
  const navigate = useNavigate();
  return (
    <nav aria-label="Settings sections" className={styles.nav}>
      {SETTINGS_SECTIONS.map((section) => (
        <button
          key={section}
          type="button"
          className={styles.navItem}
          aria-current={section === current ? 'page' : undefined}
          onClick={() => {
            void navigate(pathFor({ screen: 'S-07', section }));
          }}
        >
          {LABELS[section]}
        </button>
      ))}
    </nav>
  );
}
