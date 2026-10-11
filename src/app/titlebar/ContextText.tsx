import { cx } from '../../components/cx';
import styles from './parts.module.css';

export interface ContextTextProps {
  /**
   * repo: muted repository name · iid: MR iid in yellow (blue for own MRs with `mine`) ·
   * title: MR title or screen name, truncated · label: secondary text ("Review plan").
   */
  kind: 'repo' | 'iid' | 'title' | 'label';
  mine?: boolean;
  children: string;
}

/** A piece of title-bar context after the logo. */
export function ContextText({ kind, mine = false, children }: ContextTextProps) {
  return (
    <span className={cx(styles[kind], kind === 'iid' && mine && styles.iidMine)}>{children}</span>
  );
}
