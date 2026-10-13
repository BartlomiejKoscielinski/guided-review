import type { ReactNode } from 'react';
import { cx } from '../../components/cx';
import styles from './Column.module.css';

export type ColumnTone = 'blue' | 'white' | 'green';

export interface ColumnProps {
  /** Id of the heading; the section is labelled by it. */
  id: string;
  title: string;
  icon: ReactNode;
  tone: ColumnTone;
  /** Right side of the header: a branch name or the age of the data. */
  aside?: ReactNode;
  children: ReactNode;
}

/** One S-01 column (Start.dc.html): a colored header with icon and heading, then the body. */
export function Column({ id, title, icon, tone, aside, children }: ColumnProps) {
  return (
    <section aria-labelledby={id} className={styles.column}>
      <div className={cx(styles.header, styles[tone])}>
        {icon}
        <h2 id={id} className={styles.heading}>
          {title}
        </h2>
        {aside !== undefined && <span className={styles.aside}>{aside}</span>}
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
