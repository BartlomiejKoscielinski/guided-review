import styles from './Summary.module.css';

/**
 * The head of S-05 for a "drafts only" session (F-12.7, M5 decision 15): "SUMMARY" alone. The
 * session was made by a draft from outside a review (Explain failure on S-08, Add as a question on
 * S-12) and has no steps, so there is no progress line and no Back to steps; it reads no plan and
 * no step state.
 */
export function DraftsOnlyHeader() {
  return (
    <section className={styles.header}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Summary</h1>
      </div>
    </section>
  );
}
