import { IpcError } from '../errors';
import type { ActiveRepo } from '../types/ActiveRepo';
import type { Repo } from '../types/Repo';

/** The configured repositories of the mock (F-19.6): the S-06 mock's repository and one more. */
const FIXTURE: [Repo, Repo] = [
  {
    id: 1,
    name: 'mobile-app',
    path: 'C:\\src\\mobile-app',
    gitlabProject: 'mobile/mobile-app',
    isDefault: true,
    isActive: true,
    worktreeRoot: 'C:\\src\\.review',
  },
  {
    id: 2,
    name: 'courier-api',
    path: 'C:\\src\\courier-api',
    gitlabProject: 'mobile/courier-api',
    isDefault: false,
    isActive: false,
    worktreeRoot: 'C:\\src\\.review',
  },
];

/** Repositories and the active one, shared by the S-06 and S-01 parts of the mock backend. */
export interface MockRepos {
  list(): Repo[];
  active(): ActiveRepo | null;
  /** "Pick a repository" / "Add repository…": adds (or finds) mobile-app and makes it active. */
  pick(): ActiveRepo;
  /** Adds a typed repository path (S-01) and makes it active. */
  add(name: string, path: string): ActiveRepo;
  switchTo(id: number): ActiveRepo;
  setDefault(id: number): void;
  remove(id: number): void;
  byProject(project: string): Repo | undefined;
}

const notConfigured = () =>
  new IpcError({
    code: 'INVALID_INPUT',
    message: "That repository isn't configured any more.",
    retryable: false,
  });

export function createMockRepos(noRepo: boolean): MockRepos {
  let repos: Repo[] = noRepo ? [] : FIXTURE.map((r) => ({ ...r }));
  let activeId: number | null = noRepo ? null : 1;

  const current = (): Repo | undefined =>
    repos.find((r) => r.id === activeId) ?? repos.find((r) => r.isDefault) ?? repos.at(0);
  const find = (id: number): Repo => {
    const repo = repos.find((r) => r.id === id);
    if (!repo) throw notConfigured();
    return repo;
  };
  const describe = (repo: Repo): ActiveRepo => ({ name: repo.name, path: repo.path });
  /** Adds (or finds by path) a repository and makes it active; the first becomes the default. */
  const add = (repo: Pick<Repo, 'name' | 'path' | 'gitlabProject' | 'worktreeRoot'>) => {
    const existing = repos.find((r) => r.path.toLowerCase() === repo.path.toLowerCase());
    const added: Repo = existing ?? {
      ...repo,
      id: Math.max(0, ...repos.map((r) => r.id)) + 1,
      isDefault: repos.length === 0,
      isActive: true,
    };
    if (!existing) repos = [...repos, added];
    activeId = added.id;
    return describe(added);
  };

  return {
    list: () => {
      const active = current()?.id;
      return repos.map((r) => ({ ...r, isActive: r.id === active }));
    },
    active: () => {
      const repo = current();
      return repo ? describe(repo) : null;
    },
    pick: () => add(FIXTURE[0]),
    add: (name, path) =>
      add({
        name,
        path,
        gitlabProject: undefined,
        worktreeRoot: `${path.slice(0, Math.max(path.lastIndexOf('\\'), 0))}\\.review`,
      }),
    switchTo: (id) => {
      const repo = find(id);
      activeId = id;
      return describe(repo);
    },
    setDefault: (id) => {
      find(id);
      repos = repos.map((r) => ({ ...r, isDefault: r.id === id }));
    },
    remove: (id) => {
      const removed = repos.find((r) => r.id === id);
      repos = repos.filter((r) => r.id !== id);
      if (removed?.isDefault && repos.length > 0) {
        repos = repos.map((r, i) => ({ ...r, isDefault: i === 0 }));
      }
      if (activeId === id) activeId = null;
    },
    byProject: (project) =>
      repos.find((r) => r.gitlabProject?.toLowerCase() === project.toLowerCase()),
  };
}
