import { useParams } from 'react-router';
import type { SettingsSection } from '../../ipc/types/SettingsSection';
import { SETTINGS_SECTIONS } from '../../app/routes';
import { ClaudeSection } from './ClaudeSection';
import { SectionNav } from './SectionNav';
import styles from './Settings.module.css';

/** S-07 Settings: section nav and the section (Claude in M1; the others with their milestones). */
export function SettingsScreen() {
  const { section } = useParams();
  const current: SettingsSection = SETTINGS_SECTIONS.includes(section as SettingsSection)
    ? (section as SettingsSection)
    : 'general';
  return (
    <div className={styles.screen}>
      <SectionNav current={current} />
      <div className={styles.main}>
        {current === 'claude' ? <ClaudeSection /> : <div className={styles.stub} />}
      </div>
    </div>
  );
}
