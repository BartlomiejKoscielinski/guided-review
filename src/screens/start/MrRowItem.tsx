import { cx } from '../../components/cx';
import type { MrRow } from '../../ipc/types/MrRow';
import { age, authorName, pipelineText, sizeParts } from './mrRow';
import styles from './MergeRequests.module.css';

export interface MrRowItemProps {
  row: MrRow;
  /** When the list was fetched; all rows age alike. */
  now: number;
  disabled: boolean;
  onOpen: (row: MrRow) => void;
}

/** One MR (F-02.2): `!iid` and title; author · age, size, pipeline; the optional note. */
export function MrRowItem({ row, now, disabled, onOpen }: MrRowItemProps) {
  const size = sizeParts(row);
  return (
    <button
      type="button"
      className={styles.row}
      disabled={disabled}
      onClick={() => {
        onOpen(row);
      }}
    >
      <span className={styles.rowHead}>
        <span className={styles.iid}>!{row.iid}</span>
        <span className={styles.title}>{row.title}</span>
      </span>
      <span className={styles.meta}>
        <span>
          {authorName(row)} · {age(row.createdAt, now)}
        </span>
        <span className={styles.size}>
          <span className={styles.add}>{size.add}</span>{' '}
          <span className={styles.del}>{size.del}</span> · {size.files}
        </span>
        {row.pipeline && (
          <span className={styles.pipeline}>
            <span className={cx(styles.pipeSquare, styles[row.pipeline])} aria-hidden="true" />
            {pipelineText(row.pipeline)}
          </span>
        )}
      </span>
      {row.note && <span className={styles.note}>{row.note}</span>}
    </button>
  );
}
