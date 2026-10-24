import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { GitlabStatus } from '../types/GitlabStatus';
import type { ProjectMember } from '../types/ProjectMember';
import type { ReviewerSuggestion } from '../types/ReviewerSuggestion';
import { mockTarget } from './branchInfo';
import type { MockRepos } from './repos';

/** The project members of the mock (CreateMR.dc.html), the signed-in Bartek K. included. */
export const MOCK_MEMBERS: ProjectMember[] = [
  { id: 1, username: 'bartek.k', name: 'Bartek K.' },
  { id: 2, username: 'marta.k', name: 'Marta K.' },
  { id: 3, username: 'ola.m', name: 'Ola M.' },
  { id: 4, username: 'piotr.s', name: 'Piotr S.' },
  { id: 5, username: 'anna.k', name: 'Anna K.' },
  { id: 6, username: 'pawel.s', name: 'Paweł S.' },
];

/** The three people of the design with their reasons, the same for every target. */
const SUGGESTIONS: ReviewerSuggestion[] = [
  { id: 2, username: 'marta.k', name: 'Marta K.', reason: 'Code owner of src/App/Views/' },
  { id: 3, username: 'ola.m', name: 'Ola M.', reason: 'Wrote 58% of the changed lines' },
  { id: 4, username: 'piotr.s', name: 'Piotr S.', reason: 'Reviewed 4 MRs in Views this month' },
];

/** Lower case without Polish diacritics, so `pawel` finds Paweł. */
const fold = (text: string) =>
  text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

function notConnected(status: GitlabStatus): IpcError {
  return new IpcError(
    status.problem ?? {
      code: 'GITLAB_UNAUTHORIZED',
      message: 'Add a GitLab token in Settings › GitLab.',
      retryable: false,
    },
  );
}

/**
 * F-27.3 in the mock: `reviewers_suggest` with the guards of `git_branch_info` (a repository
 * first, then a branch on origin) and then GitLab, and `gitlab_users_search` over the members.
 */
export function createReviewersBackend(
  respond: <T>(value: T) => Promise<T>,
  repos: MockRepos,
  status: () => Promise<GitlabStatus>,
): Pick<IpcClient, 'reviewersSuggest' | 'gitlabUsersSearch'> {
  const signedIn = async () => {
    const current = await status();
    if (current.state !== 'connected' || current.user === null) throw notConnected(current);
    return current.user;
  };
  return {
    reviewersSuggest: async (target) => {
      mockTarget(repos, target);
      await signedIn();
      return respond(SUGGESTIONS);
    },
    gitlabUsersSearch: async (query) => {
      const text = fold(query.trim());
      if (text === '') return respond([]);
      const me = await signedIn();
      const found = MOCK_MEMBERS.filter(
        (m) =>
          m.username !== me.username &&
          (fold(m.name).includes(text) || fold(m.username).includes(text)),
      ).sort((a, b) => a.name.localeCompare(b.name));
      return respond(found);
    },
  };
}
