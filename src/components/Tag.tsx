import type { BlockColor } from './colors';
import { cx } from './cx';
import styles from './Tag.module.css';

export interface TagProps {
  color: BlockColor;
  /** "ring" for allowed failures and manual jobs; "filled" otherwise. */
  look?: 'filled' | 'ring';
  size?: 's' | 'm' | 'l';
  /** The word, in sentence case; CSS makes it uppercase. */
  children: string;
}

/** Word tag ("New", "Should fix", "You're the author"): color is never the only signal. */
export function Tag({ color, look = 'filled', size = 'm', children }: TagProps) {
  return (
    <span className={cx(styles.tag, styles[size], styles[color], styles[look])}>{children}</span>
  );
}
