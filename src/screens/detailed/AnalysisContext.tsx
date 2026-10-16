import { useId } from 'react';
import type { FilePlace } from '../../ipc/types/FilePlace';
import type { FileRead } from '../../ipc/types/FileRead';
import type { PlacedFile } from '../../ipc/types/PlacedFile';
import styles from './GuideAside.module.css';

export interface AnalysisContextProps {
  /** The files Claude read for the step, in its order. */
  filesRead: FileRead[];
  /** Every diff file's place for this step (`StepView.places`); others are outside. */
  places: PlacedFile[];
  selfReview: boolean;
}

/** The last folder and the file name, as the mock lists them ("Uploads/IUploadQueue.cs"). */
function shortPath(file: string): string {
  return file
    .split(/[\\/]/)
    .filter((p) => p !== '')
    .slice(-2)
    .join('/');
}

/** "· step N", "· skim", "· outside MR" (self-review: "· outside the change"; M4 decision 8). */
function placeLabel(place: FilePlace, selfReview: boolean): string {
  switch (place.kind) {
    case 'step':
      return `· step ${String(place.number)}`;
    case 'skim':
      return '· skim';
    case 'outside':
      return selfReview ? '· outside the change' : '· outside MR';
  }
}

/**
 * The Guide aside's "Analysis context" (F-08.7): the files Claude read with each one's place in
 * the review, the full path and Claude's reason as the tooltip. A self-review has no MR or
 * worktree: "Files Claude read in the repository:" (M3 decision 15).
 */
export function AnalysisContext({ filesRead, places, selfReview }: AnalysisContextProps) {
  const headingId = useId();
  const placeOf = (file: string): FilePlace =>
    places.find((p) => p.file === file)?.place ?? { kind: 'outside' };
  return (
    <section aria-labelledby={headingId} className={styles.context}>
      <h2 id={headingId} className={styles.heading}>
        Analysis context
      </h2>
      <span className={styles.intro}>
        {selfReview ? 'Files Claude read in the repository:' : 'Files Claude read in the worktree:'}
      </span>
      <div className={styles.files}>
        {filesRead.map((read) => (
          <span key={read.file} title={`${read.file} · ${read.why}`}>
            {shortPath(read.file)}{' '}
            <span className={styles.place}>{placeLabel(placeOf(read.file), selfReview)}</span>
          </span>
        ))}
      </div>
    </section>
  );
}
