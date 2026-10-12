import { useState } from 'react';
import { useNavigate } from 'react-router';
import { pathFor } from '../../app/routes';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { CommitIcon } from '../../components/icons';
import { useActiveRepo } from '../../ipc/hooks/useChanges';
import { useCommitLog, useOpenCommit } from '../../ipc/hooks/useSources';
import { Column } from './Column';
import columnStyles from './Column.module.css';
import {
  commitMeta,
  isRange,
  nextSelection,
  reviewLabel,
  reviewRange,
  selectedRows,
  type CommitSelection,
} from './commitSelection';
import { DETECT_DEBOUNCE_MS } from './SourceHero';
import { useDebounced } from './useDebounced';
import styles from './Commits.module.css';

const SKELETON_ROWS = [0, 1, 2];

/**
 * S-01 Commits column (F-03.1, F-03.2): the current branch in the header, search by message,
 * author or SHA, click / Shift+click selection, Review `<sha>` or `<from>..<to>` and Browse files.
 */
export function Commits() {
  const navigate = useNavigate();
  const repo = useActiveRepo();
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), DETECT_DEBOUNCE_MS);
  const log = useCommitLog(query, Boolean(repo.data));
  const open = useOpenCommit();
  const [selection, setSelection] = useState<CommitSelection | null>(null);
  const rows = log.data?.commits ?? [];
  const selected = selectedRows(rows, selection);
  const range = selected !== null && isRange(selected);
  // Ages as of the fetch, like the MR rows.
  const now = log.dataUpdatedAt;

  const onReview = () => {
    if (!selected) return;
    open.mutate(reviewRange(rows, selected), {
      onSuccess: (opened) => {
        void navigate(pathFor(opened.route));
      },
    });
  };

  const onBrowse = () => {
    const row = selected ? rows[selected.first] : undefined;
    if (row) void navigate(pathFor({ screen: 'S-06', commit: row.sha }));
  };

  const list = () => {
    if (repo.data === null) return <p className={columnStyles.message}>Pick a repository first.</p>;
    if (log.error) return <p className={columnStyles.message}>{log.error.message}</p>;
    if (!log.data) {
      return (
        <div className={styles.rows} aria-busy="true" aria-label="Loading commits">
          {SKELETON_ROWS.map((i) => (
            <span key={i} className={styles.skeleton} />
          ))}
        </div>
      );
    }
    if (rows.length === 0 && query !== '') {
      return <p className={columnStyles.message}>No commits match.</p>;
    }
    return (
      <div
        role="listbox"
        aria-label="Recent commits"
        aria-multiselectable="true"
        className={styles.rows}
      >
        {rows.map((row, i) => {
          const on = selected !== null && i >= selected.first && i <= selected.last;
          return (
            <button
              key={row.sha}
              type="button"
              role="option"
              aria-selected={on}
              className={cx(styles.row, on && styles.rowOn)}
              onClick={(event) => {
                setSelection((current) => nextSelection(rows, current, row.sha, event.shiftKey));
              }}
            >
              <span className={styles.sha}>{row.shortSha}</span>
              <span className={styles.subject}>{row.subject}</span>
              <span className={styles.meta}>{commitMeta(row, now)}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <Column
      id="h-commit"
      title="Commits"
      icon={<CommitIcon strokeWidth={2.2} />}
      tone="white"
      aside={log.data?.branch}
    >
      <label htmlFor="commit-search" className={styles.srOnly}>
        Search commits
      </label>
      <input
        id="commit-search"
        type="text"
        placeholder="Message, author or SHA"
        className={styles.search}
        value={search}
        disabled={!repo.data}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      {list()}
      <span className={styles.hint}>Shift + click selects a range.</span>
      {open.error && (
        <p role="alert" className={columnStyles.error}>
          {open.error.message}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          variant="primary"
          size={38}
          disabled={!selected || open.isPending}
          onClick={onReview}
        >
          Review{' '}
          <span className={styles.actionSha}>{selected ? reviewLabel(rows, selected) : ''}</span>
        </Button>
        <Button variant="neutral" size={38} disabled={!selected || range} onClick={onBrowse}>
          Browse files
        </Button>
      </div>
    </Column>
  );
}
