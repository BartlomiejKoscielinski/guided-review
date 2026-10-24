import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

// F-27.3 in the mock backend, with the people of CreateMR.dc.html. `reviewersSuggest(target?)` is
// `reviewers_suggest`: at most 3 people with one reason each, the same for every target of the
// mock, with the guards of `gitBranchInfo` (a repository first, then a branch on origin).
// `gitlabUsersSearch(query)` is `gitlab_users_search`: project members by name or username,
// case-insensitive, never the signed-in user, sorted by name; a blank query asks nobody. The
// mock's project members are exactly Anna K. (anna.k), Marta K. (marta.k), Ola M. (ola.m),
// Paweł S. (pawel.s), Piotr S. (piotr.s) and the signed-in Bartek K. (bartek.k).

const client = () => createMockClient({ latencyMs: 0 });

describe('mock reviewers (F-27.3)', () => {
  it('F-27.3 suggests the three people of the design with their reasons', async () => {
    expect(await client().reviewersSuggest()).toMatchObject([
      { username: 'marta.k', name: 'Marta K.', reason: 'Code owner of src/App/Views/' },
      { username: 'ola.m', name: 'Ola M.', reason: 'Wrote 58% of the changed lines' },
      { username: 'piotr.s', name: 'Piotr S.', reason: 'Reviewed 4 MRs in Views this month' },
    ]);
  });

  it('F-27.3 any target of the mock gets suggestions; a target that is no branch on origin is INVALID_INPUT', async () => {
    const ipc = client();
    expect(await ipc.reviewersSuggest('main')).toHaveLength(3);
    expect(await ipc.reviewersSuggest('develop')).toEqual(await ipc.reviewersSuggest());
    await expect(ipc.reviewersSuggest('nie-ma-takiej')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('F-27.3 without an active repository the suggestions are INVALID_INPUT too', async () => {
    const mock = createMockClient({ latencyMs: 0, changes: { noRepo: true } });
    await expect(mock.reviewersSuggest()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Pick a repository first.',
    });
  });

  it('F-27.3 the search finds project members by name or username, any case, sorted by name', async () => {
    const ipc = client();
    expect(await ipc.gitlabUsersSearch('ola')).toMatchObject([
      { username: 'ola.m', name: 'Ola M.' },
    ]);
    expect(await ipc.gitlabUsersSearch('PAWEŁ')).toMatchObject([
      { username: 'pawel.s', name: 'Paweł S.' },
    ]);
    expect(await ipc.gitlabUsersSearch('pawel')).toMatchObject([{ username: 'pawel.s' }]);
    expect(await ipc.gitlabUsersSearch(' k')).toMatchObject([
      { username: 'anna.k' },
      { username: 'marta.k' },
    ]);
    expect(await ipc.gitlabUsersSearch('zzz')).toEqual([]);
  });

  it('F-27.3 the search never offers the signed-in user and a blank query asks nobody', async () => {
    const ipc = client();
    expect(await ipc.gitlabUsersSearch('bartek')).toEqual([]);
    expect(await ipc.gitlabUsersSearch('')).toEqual([]);
    expect(await ipc.gitlabUsersSearch('   ')).toEqual([]);
  });

  it('F-27.3 without a token the search is GITLAB_UNAUTHORIZED, like the lists', async () => {
    const mock = createMockClient({ latencyMs: 0, gitlab: { state: 'noToken' } });
    await expect(mock.gitlabUsersSearch('ola')).rejects.toMatchObject({
      code: 'GITLAB_UNAUTHORIZED',
    });
  });
});
