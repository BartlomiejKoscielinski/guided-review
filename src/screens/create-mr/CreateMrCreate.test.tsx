import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { renderApp } from '../../test/renderApp';

// F-27.6 on S-11 (route {screen:'S-11'}), the click on **Create merge request** / **Create draft
// MR** in the aside "Reviewers and checks". IPC: `gitlabCreateMr(request)` with { target, title
// (as typed, the core adds `Draft: `), description (as typed), reviewerIds, draft,
// removeSourceBranch, squash } answering { iid, title, webUrl, pipeline: { id, status } | null }.
// Decisions of the tests stage:
// - The note under the button is ONE text element in the aside, built from the people added (in the
//   order of the Reviewer list, as the mock does): "No reviewers yet. A pipeline starts right
//   away." / "Marta K. gets notified. A pipeline starts right away." / "Marta K. and Ola M. get
//   notified. ..." (CreateMR.dc.html); from three people on "A, B and C get notified." (the mock's
//   "A and B and C" is no sentence). It is the same with Mark as draft on.
// - Nothing is sent but by the click; while the request runs the button reads "Creating…" and is
//   disabled (a second click sends nothing, like "Pushing…"); a refusal shows GitLab's message in a
//   role="alert" in the aside, keeps everything typed and the options and brings the button back,
//   so the user can fix the title and click again. A blank title is not blocked in the UI: GitLab's
//   words come back as the alert.

type Request = Parameters<IpcClient['gitlabCreateMr']>[0];
type Created = Awaited<ReturnType<IpcClient['gitlabCreateMr']>>;

const CREATED: Created = {
  iid: 483,
  title: 'Chore compiled bindings',
  webUrl: 'https://gitlab.local/mobile/mobile-app/-/merge_requests/483',
  pipeline: { id: 18361, status: 'running' },
};
const SKELETON = '## What\n\n## Why\n\n## How to test\n1. ';

function show(gitlabCreateMr: IpcClient['gitlabCreateMr'] = () => Promise.resolve(CREATED)) {
  const create = vi.fn<IpcClient['gitlabCreateMr']>(gitlabCreateMr);
  renderApp({ screen: 'S-11' }, { gitlabCreateMr: create });
  return create;
}

const aside = () => screen.findByRole('complementary', { name: 'Reviewers and checks' });
const createButton = async (name = 'Create merge request') =>
  within(await aside()).findByRole('button', { name });
const options = async () => within(await screen.findByRole('region', { name: 'Options' }));
const NOTE_TAIL = 'A pipeline starts right away.';

async function ready() {
  const title = await screen.findByRole('textbox', { name: 'Title' });
  await waitFor(() => {
    expect(title).not.toHaveValue('');
  });
  await screen.findByRole('button', { name: 'Add Marta K.' });
  return title;
}

const add = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole('button', { name: `Add ${name}` }));

describe('S-11 notify note (F-27.6)', () => {
  it('F-27.6 without reviewers the note says No reviewers yet. A pipeline starts right away.', async () => {
    show();
    await ready();
    expect(within(await aside()).getByText(`No reviewers yet. ${NOTE_TAIL}`)).toBeVisible();
  });

  it('F-27.6 one reviewer gets notified, two get notified, in the order of the list', async () => {
    const user = userEvent.setup();
    show();
    await ready();
    await add(user, 'Marta K.');
    expect(within(await aside()).getByText(`Marta K. gets notified. ${NOTE_TAIL}`)).toBeVisible();
    // Ola is added before Marta is, yet the list order (Marta, Ola) names them.
    await user.click(screen.getByRole('button', { name: 'Remove Marta K.' }));
    await add(user, 'Ola M.');
    expect(within(await aside()).getByText(`Ola M. gets notified. ${NOTE_TAIL}`)).toBeVisible();
    await add(user, 'Marta K.');
    expect(
      within(await aside()).getByText(`Marta K. and Ola M. get notified. ${NOTE_TAIL}`),
    ).toBeVisible();
  });

  it('F-27.6 three reviewers read A, B and C get notified', async () => {
    const user = userEvent.setup();
    show();
    await ready();
    await add(user, 'Marta K.');
    await add(user, 'Ola M.');
    await add(user, 'Piotr S.');
    expect(
      within(await aside()).getByText(`Marta K., Ola M. and Piotr S. get notified. ${NOTE_TAIL}`),
    ).toBeVisible();
  });

  it('F-27.6 the note stays the same under Create draft MR, and removing a reviewer takes the name out', async () => {
    const user = userEvent.setup();
    show();
    await ready();
    await add(user, 'Ola M.');
    await user.click((await options()).getByRole('checkbox', { name: 'Mark as draft' }));
    await createButton('Create draft MR');
    expect(within(await aside()).getByText(`Ola M. gets notified. ${NOTE_TAIL}`)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove Ola M.' }));
    expect(within(await aside()).getByText(`No reviewers yet. ${NOTE_TAIL}`)).toBeVisible();
  });
});

describe('S-11 Create merge request (F-27.6)', () => {
  it('F-27.6 sends nothing until the button is clicked', async () => {
    const user = userEvent.setup();
    const create = show();
    await ready();
    await add(user, 'Marta K.');
    await user.click((await options()).getByRole('checkbox', { name: 'Squash commits' }));
    expect(create).not.toHaveBeenCalled();
  });

  it('F-27.6 Create merge request sends the target, title, description, reviewers and the default options once', async () => {
    const user = userEvent.setup();
    const create = show();
    await ready();
    await add(user, 'Ola M.');
    await add(user, 'Marta K.');
    await user.click(await createButton());
    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0]?.[0];
    if (request === undefined) throw new Error('a request expected');
    expect({ ...request, reviewerIds: [...request.reviewerIds].sort() }).toEqual({
      target: 'develop',
      title: 'Chore compiled bindings',
      description: SKELETON,
      reviewerIds: [2, 3],
      draft: false,
      removeSourceBranch: true,
      squash: false,
    } satisfies Request);
  });

  it('F-27.6 without reviewers the request names none', async () => {
    const user = userEvent.setup();
    const create = show();
    await ready();
    await user.click(await createButton());
    expect(create.mock.calls[0]?.[0].reviewerIds).toEqual([]);
  });

  it('F-27.6 Create draft MR sends the typed title without a prefix and the chosen options', async () => {
    const user = userEvent.setup();
    const create = show();
    const title = await ready();
    await user.clear(title);
    await user.type(title, 'Enable compiled bindings');
    const region = await options();
    await user.click(region.getByRole('checkbox', { name: 'Mark as draft' }));
    await user.click(region.getByRole('checkbox', { name: 'Squash commits' }));
    await user.click(region.getByRole('checkbox', { name: 'Delete branch after merge' }));
    await user.click(await createButton('Create draft MR'));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      title: 'Enable compiled bindings',
      draft: true,
      squash: true,
      removeSourceBranch: false,
    });
  });

  it('F-27.6 the description goes as edited', async () => {
    const user = userEvent.setup();
    const create = show();
    await ready();
    const description = await screen.findByRole('textbox', { name: 'Description' });
    await user.clear(description);
    await user.type(description, 'Only a line');
    await user.click(await createButton());
    expect(create.mock.calls[0]?.[0].description).toBe('Only a line');
  });

  it('F-27.6 a chosen target branch and a person found by the search go into the request', async () => {
    const user = userEvent.setup();
    const create = show();
    await ready();
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Target branch' }),
      'main',
    );
    const box = await screen.findByRole('textbox', { name: 'Add another reviewer' });
    await user.type(box, 'anna');
    const results = await screen.findByRole('list', { name: 'Search results' });
    await user.click(await within(results).findByRole('button', { name: 'Add Anna K.' }));
    await user.click(await createButton());
    expect(create.mock.calls[0]?.[0]).toMatchObject({ target: 'main', reviewerIds: [5] });
  });

  it('F-27.6 while GitLab answers the button reads Creating…, is disabled, and a second click sends nothing', async () => {
    const user = userEvent.setup();
    let release: (created: Created) => void = () => undefined;
    const create = show(
      () =>
        new Promise<Created>((resolve) => {
          release = resolve;
        }),
    );
    await ready();
    await user.click(await createButton());
    const busy = await createButton('Creating…');
    expect(busy).toBeDisabled();
    expect(
      within(await aside()).queryByRole('button', { name: 'Create merge request' }),
    ).toBeNull();
    await user.click(busy);
    expect(create).toHaveBeenCalledTimes(1);
    release(CREATED);
    expect(await screen.findByRole('region', { name: 'Merge request created' })).toBeVisible();
  });

  it('F-27.6 a refusal shows the words of GitLab under the button, keeps the form and lets the user click again', async () => {
    const user = userEvent.setup();
    const message = 'Another open merge request already exists for this source branch: !482';
    const create = show(() =>
      Promise.reject(new IpcError({ code: 'CONFLICT', message, retryable: false })),
    );
    const title = await ready();
    await user.type(title, ' v2');
    await add(user, 'Marta K.');
    await user.click((await options()).getByRole('checkbox', { name: 'Squash commits' }));
    await user.click(await createButton());
    const alert = await within(await aside()).findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(screen.queryByRole('region', { name: 'Merge request created' })).toBeNull();
    expect(title).toHaveValue('Chore compiled bindings v2');
    expect(screen.getByRole('button', { name: 'Remove Marta K.' })).toBeVisible();
    expect((await options()).getByRole('checkbox', { name: 'Squash commits' })).toBeChecked();
    const again = await createButton();
    expect(again).toBeEnabled();
    await user.click(again);
    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(2);
    });
  });

  it('F-27.6 a blank title is not blocked by the screen: GitLab answers and its words show', async () => {
    const user = userEvent.setup();
    const create = show(() =>
      Promise.reject(
        new IpcError({ code: 'INVALID_INPUT', message: "title can't be blank", retryable: false }),
      ),
    );
    const title = await ready();
    await user.clear(title);
    await user.click(await createButton());
    expect(create).toHaveBeenCalledTimes(1);
    expect(await within(await aside()).findByRole('alert')).toHaveTextContent(
      "title can't be blank",
    );
  });

  it('F-27.6 a click on a disabled Create (the branch is not pushed) sends nothing', async () => {
    const user = userEvent.setup();
    const create = vi.fn<IpcClient['gitlabCreateMr']>(() => Promise.resolve(CREATED));
    renderApp(
      { screen: 'S-11' },
      {
        gitlabCreateMr: create,
        gitMergeCheck: (target) =>
          Promise.resolve({
            branch: 'chore/compiled-bindings',
            target: target ?? 'develop',
            pushed: 'notPushed',
            conflicts: [],
          }),
      },
    );
    const button = await createButton();
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    await user.click(button);
    expect(create).not.toHaveBeenCalled();
  });
});
