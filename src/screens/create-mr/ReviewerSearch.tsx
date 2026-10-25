import { useState } from 'react';
import { useUsersSearch } from '../../ipc/hooks/useReviewers';
import type { ProjectMember } from '../../ipc/types/ProjectMember';
import { useDebounced } from '../start/useDebounced';
import { ReviewerRow } from './ReviewerRow';
import styles from './Reviewers.module.css';

/** The search asks once the typing pauses this long (F-27.3). */
export const SEARCH_DEBOUNCE_MS = 250;

interface Props {
  isAdded: (username: string) => boolean;
  onToggle: (member: ProjectMember) => void;
}

/** **Add someone else…**: project members by name, added with the same toggle (F-27.3). */
export function ReviewerSearch({ isAdded, onToggle }: Props) {
  const [text, setText] = useState('');
  const typed = text.trim();
  const query = useDebounced(typed, SEARCH_DEBOUNCE_MS);
  const results = useUsersSearch(query);
  // A cleared field hides the results at once, before the debounce settles.
  const open = typed !== '' && query !== '';
  return (
    <>
      <input
        type="text"
        className={styles.search}
        aria-label="Add another reviewer"
        placeholder="Add someone else…"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      {open && results.isError && (
        <p className={styles.alert} role="alert">
          {results.error.message}
        </p>
      )}
      {open && results.data !== undefined && results.data.length === 0 && (
        <p className={styles.note}>No one found.</p>
      )}
      {open && results.data !== undefined && results.data.length > 0 && (
        <ul className={styles.list} aria-label="Search results">
          {results.data.map((member, index) => (
            <ReviewerRow
              key={member.username}
              name={member.name}
              added={isAdded(member.username)}
              index={index}
              onToggle={() => {
                onToggle(member);
                setText('');
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}
