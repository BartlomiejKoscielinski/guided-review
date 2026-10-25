import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import { createMockClient } from '../../ipc/mock';
import { renderApp } from '../../test/renderApp';

// F-25.1 on S-10 (Author.dc.html `fixClaude`, `fBusy`, `fProposed`, `fApplied`): a change thread
// of my MR, with the checkout on its source branch, offers **Fix with Claude**; the click runs
// `fixProposeThread` for that thread, the card shows "Claude is editing UploadWorker.cs…", then
// the proposal (F-25.3) and the list tags the thread "Fix proposed". Accept writes it (F-25.4):
// "Applied to your working copy. Commit it below." and the commit panel prefilled with Claude's
// explanation (M7 decision 9). Discard brings the actions back. A question thread and a
// read-only checkout (F-26.8) offer no Fix with Claude. Against the mock backend's !480.

const PROJECT = 'mobile/mobile-app';
const IID = 480;
const SENTENCE =
  'Doubles the wait after each attempt (2, 4, 8 … s) and caps it at 60 s, as Marta asked.';
/** The mock's Claude works about 1.3 s. */
const CLAUDE = { timeout: 4000 };

async function openAuthor(author: { onSourceBranch?: boolean } = {}) {
  const base = createMockClient({ latencyMs: 0, author });
  await base.repoPick();
  const fixProposeThread = vi.fn((...args: Parameters<typeof base.fixProposeThread>) =>
    base.fixProposeThread(...args),
  );
  const client = { ...base, fixProposeThread };
  const app = renderApp({ screen: 'S-01' }, client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));
  return { ...app, fixProposeThread };
}

const card = () => screen.findByRole('region', { name: 'Thread' });
const option = (name: RegExp) => {
  const found = within(screen.getByRole('listbox', { name: 'Threads' }))
    .getAllByRole('option')
    .find((o) => name.test(o.textContent));
  if (!found) throw new Error(`no thread option ${String(name)}`);
  return found;
};

describe('S-10 Fix with Claude (F-25.1)', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so a virtual list renders its rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('F-25.1 Fix with Claude on a change thread of my MR runs the fix of that thread and shows the proposal', async () => {
    const user = userEvent.setup();
    const { fixProposeThread } = await openAuthor();
    const thread = await card();
    await user.click(within(thread).getByRole('button', { name: 'Fix with Claude' }));

    expect(fixProposeThread).toHaveBeenCalledTimes(1);
    expect(fixProposeThread.mock.calls[0]?.[0]).toMatchObject({
      project: PROJECT,
      iid: IID,
      threadId: 'author-t1',
    });
    expect(await within(thread).findByText('Claude is editing UploadWorker.cs…')).toBeTruthy();
    expect(within(thread).queryByRole('button', { name: 'Fix in Rider' })).toBeNull();

    expect(await within(thread).findByText('Proposed change', {}, CLAUDE)).toBeTruthy();
    expect(within(thread).getByText('Edited 1 file: UploadWorker.cs')).toBeTruthy();
    expect(within(thread).getByText(SENTENCE)).toBeTruthy();
    expect(within(thread).getByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(option(/Marta K\./).textContent).toContain('Fix proposed');
  });

  it('F-25.1 Accept: "Applied to your working copy. Commit it below." and the commit message is Claude\'s explanation', async () => {
    const user = userEvent.setup();
    await openAuthor();
    const thread = await card();
    await user.click(within(thread).getByRole('button', { name: 'Fix with Claude' }));
    await user.click(await within(thread).findByRole('button', { name: 'Accept' }, CLAUDE));

    expect(
      await within(thread).findByText('Applied to your working copy. Commit it below.'),
    ).toBeTruthy();
    expect(within(thread).queryByRole('button', { name: 'Fix with Claude' })).toBeNull();
    const panel = await screen.findByRole('region', { name: 'Commit and push' });
    expect(
      within(panel).getByRole<HTMLInputElement>('textbox', { name: 'Commit message' }).value,
    ).toBe(SENTENCE);
    expect(option(/Marta K\./).textContent).not.toContain('Fix proposed');
  });

  it('F-25.1 Discard closes the proposal and offers Fix with Claude again', async () => {
    const user = userEvent.setup();
    await openAuthor();
    const thread = await card();
    await user.click(within(thread).getByRole('button', { name: 'Fix with Claude' }));
    await user.click(await within(thread).findByRole('button', { name: 'Discard' }, CLAUDE));

    expect(within(thread).queryByText('Proposed change')).toBeNull();
    expect(within(thread).getByRole('button', { name: 'Fix with Claude' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Commit and push' })).toBeNull();
  });

  it('F-25.1 a question thread offers no Fix with Claude', async () => {
    const user = userEvent.setup();
    await openAuthor();
    await card();
    await user.click(option(/Piotr S\./));
    const thread = await card();
    expect(await within(thread).findByRole('button', { name: 'Send reply' })).toBeTruthy();
    expect(within(thread).queryByRole('button', { name: 'Fix with Claude' })).toBeNull();
  });

  it('F-25.1 a checkout off the source branch (F-26.8) offers no Fix with Claude and runs none', async () => {
    const { fixProposeThread } = await openAuthor({ onSourceBranch: false });
    const thread = await card();
    expect(within(thread).getByRole('button', { name: 'Reply' })).toBeTruthy();
    expect(within(thread).queryByRole('button', { name: 'Fix with Claude' })).toBeNull();
    expect(fixProposeThread).not.toHaveBeenCalled();
  });
});
