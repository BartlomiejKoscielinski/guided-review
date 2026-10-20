import { cx } from '../../components/cx';
import { PipelineLink } from '../../components/PipelineLink';
import { formatAge } from '../../format/age';
import { useDrafts } from '../../ipc/hooks/useDrafts';
import { usePlan } from '../../ipc/hooks/usePlan';
import type { SessionMr } from '../../ipc/types/SessionMr';
import { plural } from '../plan/planText';
import { changeTotals } from '../plan/sourceText';
import { useSessionHeader } from '../plan/useSessionHeader';
import { ProgressSegments } from '../step/ProgressSegments';
import { useStepProgress } from '../step/useStepProgress';
import styles from './InfoHeader.module.css';

export interface InfoHeaderProps {
  sessionId: string;
  /** The step on screen: its segment is yellow. */
  stepId: string | undefined;
}

interface Totals {
  files: number;
  additions: number;
  deletions: number;
}

const byline = (author: string, date: string | undefined) =>
  [author, date ? formatAge(date) : ''].filter((part) => part !== '').join(' · ');

function Counts({ totals }: { totals: Totals }) {
  return (
    <span className={styles.mono}>
      {plural(totals.files, 'file')} <span className={styles.add}>+{totals.additions}</span>{' '}
      <span className={styles.del}>−{totals.deletions}</span>
    </span>
  );
}

function Pipeline({ mr }: { mr: SessionMr['mr'] }) {
  if (!mr.pipeline) return null;
  return (
    <PipelineLink className={styles.pipeline} iid={mr.iid}>
      <span className={cx(styles.pipeSquare, styles[`square-${mr.pipeline}`])} aria-hidden="true" />
      Pipeline <b className={cx(styles.pipeState, styles[`state-${mr.pipeline}`])}>{mr.pipeline}</b>
    </PipelineLink>
  );
}

/**
 * The S-04 info header (F-08.2, Main.dc.html's header): the S-02 header's data (F-06.1, F-17.1)
 * without the title and the commits: the branch block (a single commit's short SHA in a
 * self-review), author · age, `N files +add −del`; then "Steps" with one segment per step and
 * done/total of the steps marked reviewed, "Drafts N" of the drafts not on GitLab yet and
 * "Pipeline <status>" linking to S-08. A self-review shows "To fix N" and no pipeline (M4
 * decision 12). A count waits for the session lookup and is left out when it can't be read.
 */
export function InfoHeader({ sessionId, stepId }: InfoHeaderProps) {
  const { session, source, single, commit } = useSessionHeader(sessionId);
  // The plan the screen asked for; the header never starts one (F-30.4).
  const view = usePlan(sessionId, false).query.data;
  const { order, reviewed } = useStepProgress(sessionId);
  const drafts = useDrafts(sessionId);
  const mr = session.data;
  const index = stepId === undefined ? -1 : order.indexOf(stepId);
  const done = order.filter((id) => reviewed.includes(id)).length;
  const open = drafts.data?.filter((draft) => draft.publishedNoteId === null).length;
  const totals = mr
    ? { files: mr.totalFiles, additions: mr.additions, deletions: mr.deletions }
    : view && changeTotals(view);
  const sha = source.data?.kind === 'commits' && single ? source.data.to.slice(0, 7) : null;
  const who = mr
    ? byline(mr.mr.author, mr.mr.createdAt)
    : single && commit.data
      ? byline(commit.data.author, commit.data.date)
      : '';

  return (
    <div className={styles.info} data-testid="info-header">
      {mr && (
        <span className={styles.branch}>
          {mr.mr.sourceBranch} → {mr.mr.targetBranch}
        </span>
      )}
      {mr === null && sha !== null && <span className={styles.branch}>{sha}</span>}
      {who !== '' && <span>{who}</span>}
      {mr !== undefined && totals && <Counts totals={totals} />}
      {index >= 0 && (
        <span className={styles.steps}>
          Steps{' '}
          <span
            role="img"
            aria-label={`Step ${String(index + 1)} of ${String(order.length)}`}
            className={styles.segments}
          >
            <ProgressSegments
              order={order}
              current={stepId ?? ''}
              reviewed={reviewed}
              size="info"
            />
          </span>{' '}
          <span className={styles.value}>
            {done}/{order.length}
          </span>
        </span>
      )}
      {mr !== undefined && open !== undefined && (
        <span>
          {mr ? 'Drafts' : 'To fix'} <b className={styles.value}>{open}</b>
        </span>
      )}
      {mr && <Pipeline mr={mr.mr} />}
    </div>
  );
}
