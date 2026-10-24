import { cx } from '../../components/cx';
import styles from './Reviewers.module.css';

/** Avatar fills in list order, as CreateMR.dc.html colours Marta, Ola and Piotr. */
const AVATARS = ['var(--green)', 'var(--blue)', 'var(--orange)', 'var(--purple)', 'var(--yellow)'];

/** `MK` for `Marta K.`. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, '').charAt(0))
    .filter((letter) => letter !== '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

interface Props {
  name: string;
  /** Under the name; search results have none. */
  reason?: string;
  added: boolean;
  /** Position in its list, for the avatar fill. */
  index: number;
  onToggle: () => void;
}

/** One person with the **Add / Added** toggle (F-27.3). */
export function ReviewerRow({ name, reason, added, index, onToggle }: Props) {
  return (
    <li className={cx(styles.row, added && styles.rowOn)}>
      <span
        className={styles.avatar}
        style={{ background: AVATARS[index % AVATARS.length] }}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      <span className={styles.who}>
        <span className={styles.name}>{name}</span>
        {reason !== undefined && <span className={styles.reason}>{reason}</span>}
      </span>
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={added}
        aria-label={`${added ? 'Remove' : 'Add'} ${name}`}
        onClick={onToggle}
      >
        {added ? 'Added' : 'Add'}
      </button>
    </li>
  );
}
