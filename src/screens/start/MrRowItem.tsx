import { cx } from '../../components/cx';
import { PipelineLink } from '../../components/PipelineLink';
import type { MrRow } from '../../ipc/types/MrRow';
import { age, authorName, noteText, pipelineText, sizeParts } from './mrRow';
import styles from './MergeRequests.module.css';

export interface MrRowItemProps {
  row: MrRow;
  /** When the list was fetched; all rows age alike. */
  now: number;
  disabled: boolean;
  onOpen: (row: MrRow) => void;
}

/** The status square and words; a link to S-08 unless a review is being prepared (F-20.10). */
function Pipeline({ row, disabled }: { row: MrRow; disabled: boolean }) {
  if (!row.pipeline) return null;
  const content = (
    <>
      <span className={cx(styles.pipeSquare, styles[row.pipeline])} aria-hidden="true" />
      {pipelineText(row.pipeline)}
    </>
  );
  if (disabled) return <span className={styles.pipeline}>{content}</span>;
  return (
    <PipelineLink className={styles.pipeline} iid={row.iid}>
      {content}
    </PipelineLink>
  );
}

/**
 * One MR (F-02.2): `!iid` and title; author · age, size, pipeline; the optional note (F-02.5).
 * The open button covers the whole row; the pipeline status is its own link to S-08 above it
 * (F-20.10, M6 decision 16), because a link can't sit inside a button.
 */
export function MrRowItem({ row, now, disabled, onOpen }: MrRowItemProps) {
  const size = sizeParts(row);
  const note = noteText(row);
  const metaId = `mr-${String(row.iid)}-meta`;
  const noteId = `mr-${String(row.iid)}-note`;
  return (
    <div className={cx(styles.row, disabled && styles.rowDisabled)} data-mr-row={row.iid}>
      {/* Its ::after covers the whole row, so a click anywhere but the pipeline link opens it. */}
      <button
        type="button"
        className={styles.open}
        disabled={disabled}
        aria-describedby={note ? `${metaId} ${noteId}` : metaId}
        onClick={() => {
          onOpen(row);
        }}
      >
        <span className={styles.iid}>!{row.iid}</span>
        <span className={styles.title}>{row.title}</span>
      </button>
      <span className={styles.meta} id={metaId}>
        <span>
          {authorName(row)} · {age(row.createdAt, now)}
        </span>
        <span className={styles.size}>
          <span className={styles.add}>{size.add}</span>{' '}
          <span className={styles.del}>{size.del}</span> · {size.files}
        </span>
        {row.pipeline && <Pipeline row={row} disabled={disabled} />}
      </span>
      {note && (
        <span className={styles.note} id={noteId}>
          {note}
        </span>
      )}
    </div>
  );
}
