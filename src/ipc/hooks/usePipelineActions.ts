import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { PipelineHead } from '../types/PipelineHead';
import type { PipelineTab } from '../types/PipelineTab';
import { pipelineHeadKey, pipelineJobsKey, pipelineListKey } from './usePipeline';

export interface PipelineActions {
  /** Retry failed jobs of pipeline `id` at once (F-20.4, decision 6). */
  retry: UseMutationResult<PipelineHead, IpcError, number>;
  /** Cancel pipeline `id` at once (F-20.4, decision 6). */
  cancel: UseMutationResult<PipelineHead, IpcError, number>;
  /** Open in GitLab: the core opens the page in the default browser (decision 13). */
  open: UseMutationResult<undefined, IpcError, string>;
}

/**
 * S-08's pipeline-level actions (F-20.4), each sent only by its own click. GitLab's answer is the
 * pipeline's new head; its tab takes the new status at once, then the jobs, the head and the list
 * are read again.
 */
export function usePipelineActions(project: string, iid: number): PipelineActions {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const settle = (id: number, head: PipelineHead) => {
    queryClient.setQueryData<PipelineHead>(pipelineHeadKey(project, iid, id), head);
    queryClient.setQueryData<PipelineTab[]>(pipelineListKey(project, iid), (tabs) =>
      tabs?.map((t) => (t.id === id ? { ...t, status: head.status } : t)),
    );
    void queryClient.invalidateQueries({ queryKey: pipelineJobsKey(project, iid, id) });
    void queryClient.invalidateQueries({ queryKey: pipelineHeadKey(project, iid, id) });
    void queryClient.invalidateQueries({ queryKey: pipelineListKey(project, iid) });
  };
  const retry = useMutation<PipelineHead, IpcError, number>({
    mutationFn: (id) => ipc.pipelineRetry(project, iid, id),
    onSuccess: (head, id) => {
      settle(id, head);
    },
  });
  const cancel = useMutation<PipelineHead, IpcError, number>({
    mutationFn: (id) => ipc.pipelineCancel(project, iid, id),
    onSuccess: (head, id) => {
      settle(id, head);
    },
  });
  const open = useMutation<undefined, IpcError, string>({
    mutationFn: async (url) => {
      await ipc.osOpenGitlabUrl(url);
      return undefined;
    },
  });
  return { retry, cancel, open };
}
