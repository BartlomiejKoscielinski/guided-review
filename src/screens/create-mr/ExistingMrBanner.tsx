import { Link } from 'react-router';
import { pathFor } from '../../app/routes';
import type { ExistingMr } from '../../ipc/types/ExistingMr';
import styles from './BeforeYouCreate.module.css';

/** "An MR for this branch already exists" (F-27.5): a link to it on S-10; Create is disabled. */
export function ExistingMrBanner({ mr }: { mr: ExistingMr }) {
  return (
    <section aria-label="Existing merge request" className={styles.banner}>
      <span className={styles.bannerText}>This branch already has an open merge request.</span>
      <Link className={styles.bannerLink} to={pathFor({ screen: 'S-10', iid: mr.iid })}>
        !{mr.iid}
      </Link>
      <span className={styles.bannerTitle}>{mr.title}</span>
    </section>
  );
}
