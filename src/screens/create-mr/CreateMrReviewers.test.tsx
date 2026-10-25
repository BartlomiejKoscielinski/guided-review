import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

// F-27.3 on S-11 (route {screen:'S-11'}), the Reviewers section of CreateMR.dc.html. Locators the
// screen keeps: region "Reviewers" (a section named by its heading level 2 "Reviewers" with the
// caption "from CODEOWNERS and blame"); inside it the list "Reviewer list" whose listitems each
// hold the person's name, the reason and a toggle button named "Add <name>" (text "Add") or
// "Remove <name>" (text "Added", aria-pressed="true"); the textbox "Add another reviewer"
// (placeholder "Add someone else…"); the list "Search results" with the same listitems and
// buttons; aria-busy="true" labelled "Loading reviewers" while the suggestions load; role=alert
// for a failed load or a failed search. Open choices (tests decisions): nobody is added at the
// start; a person added from the search joins the Reviewer list with the reason "Added by you" and
// leaves it again on Remove; "No suggestions for this change." and "No one found." are the empty
// states. IPC: `reviewersSuggest(target?)` and `gitlabUsersSearch(query)`.

const OLA = { id: 3, username: 'ola.m', name: 'Ola M.', reason: 'Wrote 58% of the changed lines' };

function show(client: Partial<IpcClient> = {}) {
  const base = mockClient();
  const reviewersSuggest = vi.fn<IpcClient['reviewersSuggest']>((target) =>
    base.reviewersSuggest(target),
  );
  const gitlabUsersSearch = vi.fn<IpcClient['gitlabUsersSearch']>((query) =>
    base.gitlabUsersSearch(query),
  );
  renderApp({ screen: 'S-11' }, { reviewersSuggest, gitlabUsersSearch, ...client });
  return { reviewersSuggest, gitlabUsersSearch };
}

const section = () => screen.findByRole('region', { name: 'Reviewers' });
const list = (region: HTMLElement) => within(region).getByRole('list', { name: 'Reviewer list' });

/** The region once the three suggestions are on screen. */
async function loaded() {
  const region = await section();
  await within(region).findByText('Marta K.');
  return region;
}

const row = (region: HTMLElement, name: string): HTMLElement => {
  const found = within(list(region))
    .getAllByRole('listitem')
    .find((item) => within(item).queryByText(name) !== null);
  if (found === undefined) throw new Error(`no reviewer row for ${name}`);
  return found;
};

const searchBox = (region: HTMLElement) =>
  within(region).getByRole('textbox', { name: 'Add another reviewer' });

describe('S-11 reviewers (F-27.3)', () => {
  it('F-27.3 shows the suggestions with their reasons and an Add button each', async () => {
    show();
    const region = await loaded();
    expect(
      within(region).getByRole('heading', { level: 2, name: 'Reviewers' }),
    ).toBeInTheDocument();
    expect(within(region).getByText('from CODEOWNERS and blame')).toBeInTheDocument();
    const items = within(list(region)).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    const expected: [string, string][] = [
      ['Marta K.', 'Code owner of src/App/Views/'],
      ['Ola M.', 'Wrote 58% of the changed lines'],
      ['Piotr S.', 'Reviewed 4 MRs in Views this month'],
    ];
    expected.forEach(([name, reason], i) => {
      const item = items[i];
      if (item === undefined) throw new Error('missing row');
      expect(within(item).getByText(name)).toBeInTheDocument();
      expect(within(item).getByText(reason)).toBeInTheDocument();
      const toggle = within(item).getByRole('button', { name: `Add ${name}` });
      expect(toggle).toHaveTextContent(/^Add$/);
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
    });
    expect(within(region).queryByText('Added')).toBeNull();
    const box = searchBox(region);
    expect(box).toHaveAttribute('placeholder', 'Add someone else…');
    // The list comes first, the search field after it.
    expect(
      list(region).compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('F-27.3 Add toggles to Added and back, one person at a time', async () => {
    show();
    const region = await loaded();
    await userEvent.click(
      within(row(region, 'Marta K.')).getByRole('button', { name: 'Add Marta K.' }),
    );
    const marta = within(row(region, 'Marta K.')).getByRole('button', { name: 'Remove Marta K.' });
    expect(marta).toHaveTextContent(/^Added$/);
    expect(marta).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(row(region, 'Ola M.')).getByRole('button', { name: 'Add Ola M.' }),
    ).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(
      within(row(region, 'Piotr S.')).getByRole('button', { name: 'Add Piotr S.' }),
    );
    expect(within(region).getAllByText('Added')).toHaveLength(2);
    await userEvent.click(marta);
    const back = within(row(region, 'Marta K.')).getByRole('button', { name: 'Add Marta K.' });
    expect(back).toHaveTextContent(/^Add$/);
    expect(back).toHaveAttribute('aria-pressed', 'false');
    expect(within(region).getAllByText('Added')).toHaveLength(1);
  });

  it('F-27.3 while the suggestions load the section says so and the search is already there', async () => {
    let release: (found: (typeof OLA)[]) => void = () => undefined;
    show({
      reviewersSuggest: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const region = await section();
    const busy = await within(region).findByLabelText('Loading reviewers');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(searchBox(region)).toBeEnabled();
    release([OLA]);
    await within(region).findByText('Ola M.');
    expect(within(region).queryByLabelText('Loading reviewers')).toBeNull();
  });

  it('F-27.3 a failed load shows the error in the section and keeps the search and the rest of the screen', async () => {
    show({
      reviewersSuggest: () =>
        Promise.reject(
          new IpcError({
            code: 'GITLAB_UNAUTHORIZED',
            message: 'GitLab rejected the token.',
            retryable: false,
          }),
        ),
    });
    const region = await section();
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'GitLab rejected the token.',
    );
    expect(searchBox(region)).toBeEnabled();
    expect(await screen.findByRole('textbox', { name: 'Title' })).toBeInTheDocument();
  });

  it('F-27.3 with nobody to suggest the section says so', async () => {
    show({ reviewersSuggest: () => Promise.resolve([]) });
    const region = await section();
    expect(await within(region).findByText('No suggestions for this change.')).toBeInTheDocument();
    expect(searchBox(region)).toBeEnabled();
  });

  it('F-27.3 without a branch or without a target there is no Reviewers section and no request', async () => {
    const none = vi.fn<IpcClient['reviewersSuggest']>(() => Promise.resolve([]));
    show({
      reviewersSuggest: none,
      gitBranchInfo: () =>
        Promise.resolve({
          targets: ['develop'],
          target: 'develop',
          commits: 0,
          files: 0,
          additions: 0,
          deletions: 0,
        }),
    });
    await screen.findByRole('alert');
    expect(screen.queryByRole('region', { name: 'Reviewers' })).toBeNull();
    expect(none).not.toHaveBeenCalled();
  });

  it('F-27.3 choosing another target asks for its suggestions and keeps who was added', async () => {
    const { reviewersSuggest } = show();
    const region = await loaded();
    await userEvent.click(
      within(row(region, 'Ola M.')).getByRole('button', { name: 'Add Ola M.' }),
    );
    await userEvent.type(searchBox(region), 'anna');
    const results = await within(region).findByRole('list', { name: 'Search results' });
    await userEvent.click(within(results).getByRole('button', { name: 'Add Anna K.' }));
    const block = await screen.findByTestId('mr-branch');
    await userEvent.selectOptions(
      within(block).getByRole('combobox', { name: 'Target branch' }),
      'main',
    );
    await waitFor(() => {
      expect(reviewersSuggest).toHaveBeenLastCalledWith('main');
    });
    await within(region).findByText('Marta K.');
    expect(
      within(row(region, 'Ola M.')).getByRole('button', { name: 'Remove Ola M.' }),
    ).toBeInTheDocument();
    expect(
      within(row(region, 'Anna K.')).getByRole('button', { name: 'Remove Anna K.' }),
    ).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: 'Remove Marta K.' })).toBeNull();
  });

  it('F-27.3 typing in the search asks once after the typing pauses, with the trimmed text', async () => {
    const { gitlabUsersSearch } = show();
    const region = await loaded();
    await userEvent.type(searchBox(region), '  ann');
    expect(gitlabUsersSearch).not.toHaveBeenCalled();
    const results = await within(region).findByRole('list', { name: 'Search results' });
    expect(gitlabUsersSearch.mock.calls).toEqual([['ann']]);
    const [only, ...others] = within(results).getAllByRole('listitem');
    if (only === undefined) throw new Error('no result');
    expect(others).toHaveLength(0);
    expect(within(only).getByText('Anna K.')).toBeInTheDocument();
    expect(within(only).getByRole('button', { name: 'Add Anna K.' })).toHaveTextContent(/^Add$/);
  });

  it('F-27.3 a person from the search is added as Added by you, removed again with Remove', async () => {
    show();
    const region = await loaded();
    await userEvent.type(searchBox(region), 'anna');
    const results = await within(region).findByRole('list', { name: 'Search results' });
    await userEvent.click(within(results).getByRole('button', { name: 'Add Anna K.' }));
    // The field is empty again, the results are gone and the person sits in the Reviewer list.
    expect(searchBox(region)).toHaveValue('');
    expect(within(region).queryByRole('list', { name: 'Search results' })).toBeNull();
    const anna = row(region, 'Anna K.');
    expect(within(anna).getByText('Added by you')).toBeInTheDocument();
    const toggle = within(anna).getByRole('button', { name: 'Remove Anna K.' });
    expect(toggle).toHaveTextContent(/^Added$/);
    expect(within(list(region)).getAllByRole('listitem')).toHaveLength(4);
    await userEvent.click(toggle);
    expect(within(list(region)).getAllByRole('listitem')).toHaveLength(3);
    expect(within(region).queryByText('Anna K.')).toBeNull();
  });

  it('F-27.3 searching for somebody who is already suggested toggles that row, not a second one', async () => {
    show();
    const region = await loaded();
    await userEvent.type(searchBox(region), 'ola');
    const results = await within(region).findByRole('list', { name: 'Search results' });
    await userEvent.click(within(results).getByRole('button', { name: 'Add Ola M.' }));
    expect(within(list(region)).getAllByRole('listitem')).toHaveLength(3);
    expect(within(region).queryByText('Added by you')).toBeNull();
    expect(
      within(row(region, 'Ola M.')).getByRole('button', { name: 'Remove Ola M.' }),
    ).toBeInTheDocument();
    expect(within(region).getAllByRole('button', { name: 'Remove Ola M.' })).toHaveLength(1);
  });

  it('F-27.3 a result already added reads Added and a search without a match says so', async () => {
    show();
    const region = await loaded();
    await userEvent.click(
      within(row(region, 'Ola M.')).getByRole('button', { name: 'Add Ola M.' }),
    );
    await userEvent.type(searchBox(region), 'ola');
    const results = await within(region).findByRole('list', { name: 'Search results' });
    expect(within(results).getByRole('button', { name: 'Remove Ola M.' })).toHaveTextContent(
      /^Added$/,
    );
    await userEvent.clear(searchBox(region));
    expect(within(region).queryByRole('list', { name: 'Search results' })).toBeNull();
    await userEvent.type(searchBox(region), 'zzz');
    expect(await within(region).findByText('No one found.')).toBeInTheDocument();
    await userEvent.clear(searchBox(region));
    expect(within(region).queryByText('No one found.')).toBeNull();
  });

  it('F-27.3 a failed search shows its error in the section and the next search clears it', async () => {
    let fail = true;
    show({
      gitlabUsersSearch: (query) =>
        fail
          ? Promise.reject(
              new IpcError({
                code: 'GITLAB_UNREACHABLE',
                message: 'Cannot reach GitLab.',
                retryable: true,
              }),
            )
          : mockClient().gitlabUsersSearch(query),
    });
    const region = await loaded();
    await userEvent.type(searchBox(region), 'ola');
    expect(await within(region).findByRole('alert')).toHaveTextContent('Cannot reach GitLab.');
    // The suggestions stay usable.
    expect(list(region)).toBeInTheDocument();
    fail = false;
    await userEvent.clear(searchBox(region));
    await userEvent.type(searchBox(region), 'anna');
    await within(region).findByRole('list', { name: 'Search results' });
    expect(within(region).queryByRole('alert')).toBeNull();
  });
});
