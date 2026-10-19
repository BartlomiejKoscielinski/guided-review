import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { GitlabUser } from '../types/GitlabUser';
import { pipelineHead, pipelineTabs } from './fixtures/pipeline';

/**
 * `pipelineList` and `pipelineGet` (F-20.1) as `commands/pipeline.rs` answers them: no GitLab
 * account first, then the data of `fixtures/pipeline.ts`; an unknown pipeline is GitLab's 404.
 */
export function createPipelineBackend(
  user: () => GitlabUser | null,
  unauthorized: () => IpcError,
  respond: <T>(value: T) => Promise<T>,
): Pick<IpcClient, 'pipelineList' | 'pipelineGet'> {
  return {
    pipelineList: (_project, iid) => {
      if (!user()) return Promise.reject(unauthorized());
      return respond(pipelineTabs(iid));
    },
    pipelineGet: (_project, iid, id) => {
      if (!user()) return Promise.reject(unauthorized());
      const head = pipelineHead(iid, id);
      if (!head) {
        return Promise.reject(
          new IpcError({
            code: 'GITLAB_NOT_FOUND',
            message: "GitLab didn't find it.",
            retryable: false,
          }),
        );
      }
      return respond(head);
    },
  };
}
