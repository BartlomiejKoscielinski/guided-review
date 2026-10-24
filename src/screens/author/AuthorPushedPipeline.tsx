import { PipelineLink } from '../../components/PipelineLink';
import { useAuthorPushPipeline } from '../../ipc/hooks/useAuthorMr';
import { pushedPipelineText } from './authorText';
import styles from './AuthorCommitPanel.module.css';

export interface AuthorPushedPipelineProps {
  project: string;
  iid: number;
  /** The full SHA of the pushed commit. */
  sha: string;
  /** When the push went through (ms since the epoch). */
  pushedAt: number | null;
}

/**
 * The link after **Push and reply** (F-26.6, M7 decision 13): "Pipeline starting…" until GitLab
 * has started the pipeline of the pushed commit, then "Pipeline #18360 running"; both open S-08.
 * A failed lookup keeps "Pipeline starting…" without an alert.
 */
export function AuthorPushedPipeline({ project, iid, sha, pushedAt }: AuthorPushedPipelineProps) {
  const found = useAuthorPushPipeline(project, iid, sha, pushedAt);
  return (
    <PipelineLink iid={iid} className={styles.pipeline}>
      {pushedPipelineText(found.data ?? null)}
    </PipelineLink>
  );
}
