import { useMatches } from 'react-router';
import { StatusChip } from '../../components/StatusChip';
import { pathFor } from '../routes';
import { PLACEHOLDER } from './placeholders';

/**
 * S-10's pipeline chip (placeholder status until F-26.1 in M7): a link to S-08 of the route's
 * merge request (F-20.10), whose back link returns here.
 */
export function AuthorPipelineChip() {
  const iid = Number(useMatches().at(-1)?.params.iid ?? Number.NaN);
  const to = Number.isFinite(iid) ? pathFor({ screen: 'S-08', iid }) : undefined;
  return <StatusChip color="green" label={PLACEHOLDER.pipelineStatus} to={to} />;
}
