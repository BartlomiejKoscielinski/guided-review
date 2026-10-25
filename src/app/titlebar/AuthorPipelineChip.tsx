import { StatusChip } from '../../components/StatusChip';
import type { BlockColor } from '../../components/colors';
import type { PipelineState } from '../../ipc/types/PipelineState';
import { useRouteAuthorMr } from '../../screens/author/useRouteAuthorMr';
import { pathFor } from '../routes';

/** The square of a pipeline status, as S-01 colours it (passed green, failed orange, running blue). */
const COLOR: Record<PipelineState, BlockColor> = {
  passed: 'green',
  failed: 'orange',
  running: 'blue',
  waiting: 'blue',
  canceled: 'white',
  skipped: 'white',
  manual: 'white',
};

/**
 * S-10's pipeline chip (F-26.1): the head pipeline of my MR as the core reads it, a link to S-08
 * of the route's MR (F-20.10) whose back link returns here. Nothing while the MR loads, after a
 * failed read and on a restored start (F-30.4).
 */
export function AuthorPipelineChip() {
  const { iid, mr } = useRouteAuthorMr();
  if (!mr.isSuccess || !Number.isFinite(iid)) return null;
  const pipeline = mr.data.pipeline;
  return (
    <StatusChip
      color={pipeline ? COLOR[pipeline.status] : 'white'}
      label={pipeline ? `Pipeline ${pipeline.status}` : 'No pipeline'}
      to={pathFor({ screen: 'S-08', iid })}
    />
  );
}
