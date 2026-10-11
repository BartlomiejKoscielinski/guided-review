import { ChevronDownIcon } from '../../components/icons';
import styles from './parts.module.css';

export interface RepoSwitcherProps {
  name: string;
  path: string;
}

/**
 * Repository switcher on S-01 and S-06 (F-30.7). In M0 it shows the repository only; the menu
 * with the configured repositories and "Add repository…" comes with M2.
 */
export function RepoSwitcher({ name, path }: RepoSwitcherProps) {
  return (
    <button
      type="button"
      className={styles.repoSwitcher}
      aria-label={`Repository ${name}, ${path}`}
    >
      <span className={styles.repoName}>{name}</span>
      <span className={styles.repoPath}>{path}</span>
      <ChevronDownIcon className={styles.chevron} />
    </button>
  );
}
