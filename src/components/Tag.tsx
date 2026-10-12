import type { BlockColor } from './colors';
import { cx } from './cx';
import styles from './Tag.module.css';

export interface TagProps {
  /** Native tooltip (RENAMED: the old path). */
  title?: string;
  color: BlockColor;
  /** "ring" for allowed failures and manual jobs; "filled" otherwise. */
  look?: 'filled' | 'ring';
  /** xs = file status in the S-06 tree (11px, 16px line). */
  size?: 'xs' | 's' | 'm' | 'l';
  /** The word, in sentence case; CSS makes it uppercase. */
  children: string;
}

/** Word tag ("New", "Should fix", "You're the author"): color is never the only signal. */
export function Tag({ color, look = 'filled', size = 'm', title, children }: TagProps) {
  return (
    <span className={cx(styles.tag, styles[size], styles[color], styles[look])} title={title}>
      {children}
    </span>
  );
}
