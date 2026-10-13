import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { OpenedSession } from '../types/OpenedSession';
import type { PrepareProgress } from '../types/PrepareProgress';
import type { MrRow } from '../types/MrRow';
import type { SessionMr } from '../types/SessionMr';
import type { TreeFile } from '../types/TreeFile';
import { groupFiles } from './changes';
import { lineCounts, MR_BRANCHES, mrFiles } from './fixtures/mr';
import { findMockMr } from './gitlab';
import type { MockRepos } from './repos';

type PrepareClient = Pick<IpcClient, 'sessionOpenMr' | 'sessionPrepareCancel' | 'sessionMr'>;

/** Pause between preparation stages, so S-02 Preparing is visible in `npm run dev:mock`. */
export const MOCK_STAGE_MS = 400;

const MR_SESSION = 'mock-mr-session-';

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
  const opened = new Map<string, MrRow>();

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
      const sessionId = `${MR_SESSION}${String(sessions)}`;
      opened.set(sessionId, mr);
      const result: OpenedSession = { sessionId, route: { screen: 'S-02', sessionId } };
      return result;
    },
    sessionMr: async (sessionId) => {
      const mr = opened.get(sessionId);
      // Commit and local sessions of the sources mock have no MR.
      if (!mr && !sessionId.startsWith(MR_SESSION)) return null;
      if (!mr) throw error('INVALID_INPUT', 'Unknown session.');
      await pause(0);
      const files: TreeFile[] = mrFiles().map((file) => ({
        path: file.path,
        name: file.path.split('/').pop() ?? file.path,
        oldPath: file.oldPath,
        status: file.status,
        binary: false,
        ...lineCounts(file),
        untracked: false,
      }));
      const result: SessionMr = {
        mr: {
          iid: mr.iid,
          title: mr.title,
          author: mr.author.name,
          createdAt: mr.createdAt,
          sourceBranch: MR_BRANCHES.source,
          targetBranch: MR_BRANCHES.target,
          pipeline: mr.pipeline ?? undefined,
        },
        groups: groupFiles(files),
        totalFiles: files.length,
        additions: files.reduce((sum, f) => sum + f.additions, 0),
        deletions: files.reduce((sum, f) => sum + f.deletions, 0),
        commits: 3,
      };
      return result;
    },
    sessionPrepareCancel: (task) => {
      cancelled.add(task);
      return Promise.resolve();
    },
  };
}
