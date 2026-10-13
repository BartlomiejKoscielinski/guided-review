import type { ReactNode } from 'react';
import styles from './Plan.module.css';

export interface PlanHeaderProps {
  /** The MR title (F-06.1); also the heading while preparing (02 › S-02 Preparing). */
  title: string;
  meta?: ReactNode;
  actions: ReactNode;
}

/** S-02 header: the MR title as the page heading, the meta line, the actions on the right. */
export function PlanHeader({ title, meta, actions }: PlanHeaderProps) {
  return (
    <section className={styles.header}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{title}</h1>
        {meta && <div className={styles.meta}>{meta}</div>}
      </div>
      <div className={styles.actions}>{actions}</div>
    </section>
  );
}
