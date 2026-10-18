import { cx } from '../../components/cx';
import type { Thread } from '../../ipc/types/Thread';
import { filterLabels, type ThreadFilter } from './threadFilter';
import styles from './Threads.module.css';

export interface ThreadFiltersProps {
  /** The MR's threads as GitLab answered them; the counts are over the resolvable ones. */
  threads: readonly Thread[];
  filter: ThreadFilter;
  onChange: (filter: ThreadFilter) => void;
}

/**
 * All / Open N / Resolved N (F-13.1, SummaryDesk.dc.html): a group "Thread filter" of toggle
 * buttons with aria-pressed, right of the tabs in their row. Each button is its own Tab stop and
 * works with Enter and Space; the numbers count every listed thread, whatever the pick.
 */
export function ThreadFilters({ threads, filter, onChange }: ThreadFiltersProps) {
  return (
    <div role="group" aria-label="Thread filter" className={styles.filters}>
      {filterLabels(threads).map((f) => {
        const on = f.id === filter;
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={on}
            className={cx(styles.filter, on && styles.filterOn)}
            onClick={() => {
              onChange(f.id);
            }}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
