import type { BlockColor } from '../../components/colors';
import { Square } from '../../components/Square';
import styles from './parts.module.css';

export interface StatusTextProps {
  color: BlockColor;
  children: string;
}

/** Square and words, e.g. "GitLab connected" on S-01 or the plan status on S-02. */
export function StatusText({ color, children }: StatusTextProps) {
  return (
    <span className={styles.status}>
      <Square color={color} />
      {children}
    </span>
  );
}
