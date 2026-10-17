import { foreignText } from './publishCopy';
import styles from './Publish.module.css';

export interface ForeignDraftsBannerProps {
  /** Draft comments in GitLab's own review of the MR; at least 1. */
  count: number;
}

/**
 * M5 decision 8: GitLab's bulk publish sends every pending draft of the user, the ones written in
 * GitLab's web UI too, so a yellow block says how many before Publish. Publish stays available.
 */
export function ForeignDraftsBanner({ count }: ForeignDraftsBannerProps) {
  return (
    <div role="status" className={styles.foreign}>
      {foreignText(count)}
    </div>
  );
}
