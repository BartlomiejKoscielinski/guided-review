import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { PipelineHead } from '../types/PipelineHead';
import type { PipelineTab } from '../types/PipelineTab';

export const pipelineListKey = (project: string, iid: number) =>
  ['gitlab', 'pipelines', project, iid] as const;
export const pipelineHeadKey = (project: string, iid: number, id: number) =>
  ['gitlab', 'pipeline', project, iid, id] as const;

/**
 * S-08's tabs: the MR's pipelines newest first (F-20.1). `enabled` is false on a restored start
 * and until the project is known (F-30.4).
 */
export function usePipelineList(
  project: string | undefined,
  iid: number,
  enabled: boolean,
): UseQueryResult<PipelineTab[], IpcError> {
  const ipc = useIpc();
  return useQuery<PipelineTab[], IpcError>({
    queryKey: pipelineListKey(project ?? '', iid),
    queryFn: () => ipc.pipelineList(project ?? '', iid),
    enabled: enabled && project !== undefined && project !== '',
  });
}

/** The status block and meta line of the selected pipeline (F-20.1); `id` null reads nothing. */
export function usePipelineHead(
  project: string | undefined,
  iid: number,
  id: number | null,
): UseQueryResult<PipelineHead, IpcError> {
  const ipc = useIpc();
  return useQuery<PipelineHead, IpcError>({
    queryKey: pipelineHeadKey(project ?? '', iid, id ?? 0),
    queryFn: () => ipc.pipelineGet(project ?? '', iid, id ?? 0),
    enabled: project !== undefined && project !== '' && id !== null,
  });
}
