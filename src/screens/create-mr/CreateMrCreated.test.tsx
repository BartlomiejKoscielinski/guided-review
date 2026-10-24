import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { renderApp } from '../../test/renderApp';

// F-27.6 on S-11 after Create (CreateMR.dc.html with {"created":true}, S11-create-mr-created.png):
// the whole screen is replaced by the success view: no heading "New merge request", no form, no
// aside. Locators the screen keeps: the green block is a region named "Merge request created"
// (a <section aria-label>) holding the visible text "Merge request created", the number "!483"
// as one text element and the title of the MR (the one GitLab answered, with its `Draft: `); the
// pipeline tile is ONE link (to S-08, /mr/<iid>/pipeline) whose name holds "Pipeline" and
// "#18361 running" ("#<id> <status>"); the tiles "Reviewers notified" and "You’ll hear about" each
// have their label and their value as two text elements in one parent; the actions are the link
// "Go to your MR" (S-10, /mr/<iid>/author) and the buttons "Copy link" and "Open in GitLab".
// Decisions of the tests stage:
// - The pipeline is the one GitLab answered; while it has none the tile reads "Pipeline
//   starting…" and still opens S-08 (nothing is polled).
// - Reviewers notified lists the people that were added, in the order of the Reviewer list,
//   joined with ", " (the mock), or "nobody yet" without any.
// - Copy link copies the MR's web URL and a status text says "Copied." / "Couldn’t copy." (as Copy
//   as checklist, F-17.4); Open in GitLab calls `osOpenGitlabUrl(webUrl)` once, and its failure
//   shows the message in a role="alert" (as Open in GitLab on S-08).

type Created = Awaited<ReturnType<IpcClient['gitlabCreateMr']>>;

const MR_URL = 'https://gitlab.local/mobile/mobile-app/-/merge_requests/483';
const CREATED: Created = {
  iid: 483,
  title: 'Chore compiled bindings',
  webUrl: MR_URL,
  pipeline: { id: 18361, status: 'running' },
};

function show(created: Created = CREATED, extra: Partial<IpcClient> = {}) {
  return renderApp(
    { screen: 'S-11' },
    { gitlabCreateMr: () => Promise.resolve(created), ...extra },
  );
}

/** Adds the people, clicks Create and waits for the success view. */
async function created(user: ReturnType<typeof userEvent.setup>, people: string[] = []) {
  const title = await screen.findByRole('textbox', { name: 'Title' });
  await waitFor(() => {
    expect(title).not.toHaveValue('');
  });
  for (const name of people) {
    await user.click(await screen.findByRole('button', { name: `Add ${name}` }));
  }
  const aside = await screen.findByRole('complementary', { name: 'Reviewers and checks' });
  await user.click(
    await within(aside).findByRole('button', { name: /^Create (merge request|draft MR)$/ }),
  );
  return screen.findByRole('region', { name: 'Merge request created' });
}

describe('S-11 created (F-27.6)', () => {
  it('F-27.6 the green block names the MR: Merge request created, !483 and the title', async () => {
    const user = userEvent.setup();
    show();
    const block = await created(user);
    expect(within(block).getByText('Merge request created')).toBeVisible();
    expect(within(block).getByText('!483')).toBeVisible();
    expect(within(block).getByText('Chore compiled bindings')).toBeVisible();
  });

  it('F-27.6 a draft MR shows the title GitLab stored, with Draft:', async () => {
    const user = userEvent.setup();
    show({ ...CREATED, iid: 490, title: 'Draft: Chore compiled bindings' });
    const block = await created(user);
    expect(within(block).getByText('!490')).toBeVisible();
    expect(within(block).getByText('Draft: Chore compiled bindings')).toBeVisible();
  });

  it('F-27.6 the success view replaces the form, the aside and the heading', async () => {
    const user = userEvent.setup();
    show();
    await created(user);
    expect(screen.queryByRole('heading', { name: 'New merge request' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Options' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Reviewers' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Before you create' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Create (merge request|draft MR)$/ })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Reviewers and checks' })).toBeNull();
  });

  it('F-27.6 the pipeline tile links to S-08 with the pipeline number and state', async () => {
    const user = userEvent.setup();
    show();
    await created(user);
    const link = screen.getByRole('link', { name: /#18361 running/ });
    expect(link).toHaveAccessibleName(/Pipeline/);
    expect(link).toHaveAttribute('href', '/mr/483/pipeline');
  });

  it('F-27.6 while GitLab has no pipeline the tile reads Pipeline starting… and still opens S-08', async () => {
    const user = userEvent.setup();
    show({ ...CREATED, pipeline: null });
    await created(user);
    const link = screen.getByRole('link', { name: /Pipeline starting…/ });
    expect(link).toHaveAttribute('href', '/mr/483/pipeline');
    expect(screen.queryByText(/#\d+ /)).toBeNull();
  });

  it('F-27.6 Reviewers notified names the people added, in the order of the list', async () => {
    const user = userEvent.setup();
    show();
    await created(user, ['Ola M.', 'Marta K.']);
    const label = screen.getByText('Reviewers notified');
    const tile = label.parentElement;
    if (tile === null) throw new Error('the tile has a parent');
    expect(within(tile).getByText('Marta K., Ola M.')).toBeVisible();
  });

  it('F-27.6 Reviewers notified says nobody yet without reviewers', async () => {
    const user = userEvent.setup();
    show();
    await created(user);
    const tile = screen.getByText('Reviewers notified').parentElement;
    if (tile === null) throw new Error('the tile has a parent');
    expect(within(tile).getByText('nobody yet')).toBeVisible();
  });

  it('F-27.6 You’ll hear about comments and pipeline, in the tray', async () => {
    const user = userEvent.setup();
    show();
    await created(user);
    const tile = screen.getByText('You’ll hear about').parentElement;
    if (tile === null) throw new Error('the tile has a parent');
    expect(within(tile).getByText('comments and pipeline, in the tray')).toBeVisible();
  });

  it('F-27.6 Go to your MR opens S-10 of the new MR', async () => {
    const user = userEvent.setup();
    const { router } = show();
    await created(user);
    const go = screen.getByRole('link', { name: 'Go to your MR' });
    expect(go).toHaveAttribute('href', '/mr/483/author');
    await user.click(go);
    expect(router.state.location.pathname).toBe('/mr/483/author');
  });

  it('F-27.6 Copy link puts the web URL on the clipboard and says Copied.', async () => {
    const user = userEvent.setup();
    show();
    await created(user);
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Copied.')).toBeVisible();
    expect(await navigator.clipboard.readText()).toBe(MR_URL);
  });

  it('F-27.6 Copy link says Couldn’t copy. when the clipboard refuses', async () => {
    const user = userEvent.setup();
    show();
    await created(user);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Couldn’t copy.')).toBeVisible();
  });

  it('F-27.6 Open in GitLab opens the MR page once through osOpenGitlabUrl', async () => {
    const user = userEvent.setup();
    const osOpenGitlabUrl = vi.fn<IpcClient['osOpenGitlabUrl']>(() => Promise.resolve());
    show(CREATED, { osOpenGitlabUrl });
    await created(user);
    await user.click(screen.getByRole('button', { name: 'Open in GitLab' }));
    expect(osOpenGitlabUrl).toHaveBeenCalledTimes(1);
    expect(osOpenGitlabUrl).toHaveBeenCalledWith(MR_URL);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('F-27.6 when the link cannot be opened the message shows as an alert', async () => {
    const user = userEvent.setup();
    const message = 'That link isn’t on your GitLab server.';
    show(CREATED, {
      osOpenGitlabUrl: () =>
        Promise.reject(new IpcError({ code: 'INVALID_INPUT', message, retryable: false })),
    });
    await created(user);
    await user.click(screen.getByRole('button', { name: 'Open in GitLab' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
});
