import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { OpenedSession } from '../types/OpenedSession';
import type { PrepareProgress } from '../types/PrepareProgress';
import { findMockMr } from './gitlab';
import type { MockRepos } from './repos';

type PrepareClient = Pick<IpcClient, 'sessionOpenMr' | 'sessionPrepareCancel'>;

/** Pause between preparation stages, so S-02 Preparing is visible in `npm run dev:mock`. */
export const MOCK_STAGE_MS = 400;

const error = (code: IpcError['code'], message: string) =>
  new IpcError({ code, message, retryable: false });

/**
 * MR preparation of the mock backend (F-05.1, F-05.6): the repository of the project (switched
 * to, decision 7), an MR of the mock lists (else the F-01.5 copy), the three stages with pauses,
 * and cancel by task ID.
 */
export function createPrepareBackend(
  repos: MockRepos,
  pause: (ms: number) => Promise<void>,
): PrepareClient {
  const cancelled = new Set<string>();
  let sessions = 0;

  const resolveProject = (project: string | null): string => {
    if (project !== null && project.trim() !== '') {
      const repo = repos.byProject(project.trim());
      if (!repo?.gitlabProject) {
        throw error(
          'INVALID_INPUT',
          `${project.trim()} is not one of your repositories. Add it in Settings › GitLab.`,
        );
      }
      if (!repo.isActive) repos.switchTo(repo.id);
      return repo.gitlabProject;
    }
    const active = repos.list().find((r) => r.isActive);
    if (!active) throw error('INVALID_INPUT', 'Pick a repository first.');
    if (!active.gitlabProject) {
      throw error(
        'INVALID_INPUT',
        "The repository's origin isn't a project on the configured GitLab server.",
      );
    }
    return active.gitlabProject;
  };

  return {
    sessionOpenMr: async (iid, project, task, onProgress) => {
      const resolved = resolveProject(project);
      const mr = findMockMr(iid);
      if (!mr) throw error('GITLAB_NOT_FOUND', `No merge request !${String(iid)} in ${resolved}`);
      const stages: PrepareProgress[] = [
        { stage: 'fetching', iid, title: mr.title },
        { stage: 'creatingWorktree' },
        { stage: 'computingDiff' },
        { stage: 'computingDiff', files: mr.files },
      ];
      try {
        for (const stage of stages) {
          if (cancelled.has(task)) throw error('CANCELLED', 'Cancelled.');
          onProgress(stage);
          await pause(MOCK_STAGE_MS);
        }
        if (cancelled.has(task)) throw error('CANCELLED', 'Cancelled.');
      } finally {
        cancelled.delete(task);
      }
      sessions += 1;
      const sessionId = `mock-mr-session-${String(sessions)}`;
      const opened: OpenedSession = { sessionId, route: { screen: 'S-02', sessionId } };
      return opened;
    },
    sessionPrepareCancel: (task) => {
      cancelled.add(task);
      return Promise.resolve();
    },
  };
}
