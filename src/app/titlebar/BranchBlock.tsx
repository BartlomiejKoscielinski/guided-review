import styles from './parts.module.css';

export interface BranchBlockProps {
  branch: string;
}

/** Green block with the branch name (S-06, S-11). */
export function BranchBlock({ branch }: BranchBlockProps) {
  return <span className={styles.branch}>{branch}</span>;
}
