import { useId, useState } from 'react';
import type { ChangeStats } from '../../ipc/types/ChangeStats';
import type { SkimGroup } from '../../ipc/types/SkimGroup';
import { plural } from './planText';
import styles from './PlanList.module.css';

export interface SkimRowProps {
  group: SkimGroup;
  stats: ChangeStats;
  files: readonly string[];
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

/** The skim row (F-06.6): "Skim: N mechanical files", Claude's reason, Show lists the files. */
export function SkimRow({ group, stats, files }: SkimRowProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
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
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? 'Hide' : 'Show'}
      </button>
      {open && (
        <ul id={listId} className={styles.skimFiles} aria-label="Skim files">
          {files.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
