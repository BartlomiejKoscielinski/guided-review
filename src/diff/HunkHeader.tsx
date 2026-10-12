import { Checkbox } from '../components/Checkbox';
import { cx } from '../components/cx';
import type { Hunk } from '../ipc/types/Hunk';
import { hunkRange } from './rows';
import { hunkState, type DiffStaging } from './staging';
import styles from './DiffView.module.css';

export interface HunkHeaderProps {
  hunk: Hunk;
  first: boolean;
  /** "new file" / "deleted file" instead of the line range. */
  fileLabel?: string;
  staging?: DiffStaging;
}

/** The bar above a hunk: In commit checkbox (local mode), line range and function context. */
export function HunkHeader({ hunk, first, fileLabel, staging }: HunkHeaderProps) {
  const state = hunkState(hunk);
  const label = [fileLabel ?? hunkRange(hunk), hunk.header].filter(Boolean).join(' · ');
  return (
    <div className={cx(styles.hunkWrap, !first && styles.gap)}>
      <div className={styles.hunkHeader}>
        {staging && (
          <Checkbox
            state={state}
            label={`In commit · ${label}`}
            className={styles.inCommit}
            onToggle={() => {
              staging.onHunk(hunk, state !== 'on');
            }}
          >
            In commit
          </Checkbox>
        )}
        <span className={styles.range}>{label}</span>
        {hunk.stagedDiffers && (
          <span className={styles.differs}>
            The staged version of these lines differs from the file.
          </span>
        )}
      </div>
    </div>
  );
}
