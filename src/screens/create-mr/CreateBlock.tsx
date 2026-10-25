import { Button } from '../../components/Button';
import styles from './Reviewers.module.css';

interface Props {
  draft: boolean;
  /** Not pushed, an open MR of the branch, or the checks still loading (F-27.5). */
  blocked: boolean;
  creating: boolean;
  /** GitLab's words for a refusal of the last click. */
  error: string | null;
  note: string;
  onCreate: () => void;
}

/**
 * The foot of S-11's aside (F-27.6): **Create merge request** / **Create draft MR**, "Creating…"
 * while GitLab answers, the note on who gets notified, and GitLab's words for a refusal.
 */
export function CreateBlock({ draft, blocked, creating, error, note, onCreate }: Props) {
  const label = draft ? 'Create draft MR' : 'Create merge request';
  return (
    <div className={styles.createBlock}>
      <Button variant="primary" size={50} disabled={blocked || creating} onClick={onCreate}>
        {creating ? 'Creating…' : label}
      </Button>
      <span className={styles.createNote}>{note}</span>
      {error !== null && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
