import type { BlockColor } from './colors';
import { cx } from './cx';
import styles from './Square.module.css';

export type SquareSize = 8 | 9 | 10 | 12 | 14;

export interface SquareProps {
  color: BlockColor;
  size?: SquareSize;
}

/**
 * Color square used as a legend or status indicator (Claude, status, severity). It is always
 * paired with a word, so it is decorative for assistive technology.
 */
export function Square({ color, size = 8 }: SquareProps) {
  return (
    <span
      className={cx(styles.square, styles[color], styles[`s${String(size)}`])}
      aria-hidden="true"
      data-color={color}
    />
  );
}
