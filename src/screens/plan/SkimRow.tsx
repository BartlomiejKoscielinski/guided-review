import type { ChangeStats } from '../../ipc/types/ChangeStats';
import type { SkimGroup } from '../../ipc/types/SkimGroup';
import { plural } from './planText';
import styles from './PlanList.module.css';

export interface SkimRowProps {
  group: SkimGroup;
  stats: ChangeStats;
  files: readonly string[];
  /** Show: the S-06 browse of the MR with only these files. */
  onShow?: (files: readonly string[]) => void;
}

function SkimIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d="M4 6l4-3 4 3M4 10l4 3 4-3" />
    </svg>
  );
}

/** The skim row (F-06.6): "Skim: N mechanical files", Claude's reason, Show opens the files. */
export function SkimRow({ group, stats, files, onShow }: SkimRowProps) {
  return (
    <li className={styles.skim}>
      <span />
      <span className={styles.skimMark}>
        <SkimIcon />
      </span>
      <span className={styles.body}>
        <span className={styles.skimTitle}>Skim: {plural(stats.files, 'mechanical file')}</span>
        <span className={styles.reason}>{group.reason}</span>
      </span>
      <button
        type="button"
        className={styles.show}
        onClick={() => {
          onShow?.(files);
        }}
      >
        Show
      </button>
    </li>
  );
}
