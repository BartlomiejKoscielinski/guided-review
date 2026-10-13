import { Button } from '../../components/Button';
import { Square } from '../../components/Square';
import styles from './Plan.module.css';

export interface FallbackBannerProps {
  /** The core's message (why Claude couldn't plan). */
  message: string;
  retrying: boolean;
  onRetry: () => void;
}

/** S-02 Claude failed (02 › S-02): the plan is the app's file order; Retry runs Claude again. */
export function FallbackBanner({ message, retrying, onRetry }: FallbackBannerProps) {
  return (
    <section className={styles.banner} role="status" aria-label="Claude isn't available">
      <Square color="orange" size={10} />
      <span className={styles.bannerText}>
        Claude isn't available. You can review in file order.
        <span className={styles.bannerDetail}>{message}</span>
      </span>
      <Button size={36} onClick={onRetry} disabled={retrying}>
        Retry
      </Button>
    </section>
  );
}
