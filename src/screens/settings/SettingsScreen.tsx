import type { ComponentType } from 'react';
import { useParams } from 'react-router';
import type { SettingsSection } from '../../ipc/types/SettingsSection';
import { SETTINGS_SECTIONS } from '../../app/routes';
import { ClaudeSection } from './ClaudeSection';
import { GitlabSection } from './GitlabSection';
import { IntegrationsSection } from './IntegrationsSection';
import { SectionNav } from './SectionNav';
import styles from './Settings.module.css';

const SECTIONS: Partial<Record<SettingsSection, ComponentType>> = {
  claude: ClaudeSection,
  gitlab: GitlabSection,
  integrations: IntegrationsSection,
};

/** S-07 Settings: section nav and the section (Claude in M1, GitLab and Integrations in M2). */
export function SettingsScreen() {
  const { section } = useParams();
  const current: SettingsSection = SETTINGS_SECTIONS.includes(section as SettingsSection)
    ? (section as SettingsSection)
    : 'general';
  const Section = SECTIONS[current];
  return (
    <div className={styles.screen}>
      <SectionNav current={current} />
      <div className={styles.main}>{Section ? <Section /> : <div className={styles.stub} />}</div>
    </div>
  );
}
