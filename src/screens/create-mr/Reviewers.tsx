import { useReviewerSuggestions } from '../../ipc/hooks/useReviewers';
import type { ProjectMember } from '../../ipc/types/ProjectMember';
import { ReviewerRow } from './ReviewerRow';
import { ReviewerSearch } from './ReviewerSearch';
import styles from './Reviewers.module.css';

/** A person the user added, with the reason the row shows. */
export interface AddedReviewer {
  id: number;
  username: string;
  name: string;
  reason: string;
}

/** The reason of a person added from the search. */
export const ADDED_BY_YOU = 'Added by you';

interface Props {
  target: string;
  added: AddedReviewer[];
  onAdded: (next: AddedReviewer[]) => void;
}

/**
 * S-11 Reviewers (F-27.3): the suggestions with their reasons (code owner, blame share, review
 * history), each with **Add / Added**, and the search for others. Nobody is added at the start;
 * people the user added stay when the target changes.
 */
export function Reviewers({ target, added, onAdded }: Props) {
  const suggestions = useReviewerSuggestions(target);
  const suggested = suggestions.data ?? [];
  const isAdded = (username: string) => added.some((a) => a.username === username);
  const toggle = (person: AddedReviewer) => {
    onAdded(
      isAdded(person.username)
        ? added.filter((a) => a.username !== person.username)
        : [...added, person],
    );
  };
  // The suggestions, then whoever was added and isn't suggested (from the search or another
  // target), with the reason they were added with.
  const rows: AddedReviewer[] = [
    ...suggested,
    ...added.filter((a) => !suggested.some((s) => s.username === a.username)),
  ];
  const fromSearch = (member: ProjectMember) => {
    const own = suggested.find((s) => s.username === member.username);
    toggle(own ?? { ...member, reason: ADDED_BY_YOU });
  };

  return (
    <section className={styles.section} aria-labelledby="mr-reviewers">
      <div className={styles.head}>
        <h2 id="mr-reviewers" className={styles.heading}>
          Reviewers
        </h2>
        <span className={styles.caption}>from CODEOWNERS and blame</span>
      </div>
      {suggestions.isPending ? (
        <div className={styles.loading} aria-busy="true" aria-label="Loading reviewers">
          <span />
          <span />
          <span />
        </div>
      ) : suggestions.isError ? (
        <p className={styles.alert} role="alert">
          {suggestions.error.message}
        </p>
      ) : (
        suggested.length === 0 && <p className={styles.note}>No suggestions for this change.</p>
      )}
      {rows.length > 0 && (
        <ul className={styles.list} aria-label="Reviewer list">
          {rows.map((row, index) => (
            <ReviewerRow
              key={row.username}
              name={row.name}
              reason={row.reason}
              added={isAdded(row.username)}
              index={index}
              onToggle={() => {
                toggle(row);
              }}
            />
          ))}
        </ul>
      )}
      <ReviewerSearch isAdded={isAdded} onToggle={fromSearch} />
    </section>
  );
}
