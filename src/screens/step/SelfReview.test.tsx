import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from '../../ipc/mock';
import { useFocusStore, type FocusLayout } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// S-03 of a self-review (F-17.2): a session of local changes or commits has no MR, so nothing
// reaches GitLab. Note cards say Keep to fix, and no publish, approve or thread controls show.

const MR_SESSION = 'mock-mr-session-1';
const KEPT = "Kept to fix. It's on your list at the end.";
const DISMISSED = "Dismissed. Claude won't raise it again for this commit.";
const PHOTO = 'The whole photo goes into SQLite as byte[]';
const PENDING = 'PendingCount won’t refresh after upload';
const WORKFLOW = /publish|approve|resolve|reply|reopen/i;

/** S-03 on step 4 of a session of the given kind, opened as S-01 opens it, in the given layout. */
async function openStep4(kind: 'local' | 'commit' | 'mr' = 'local', layout: FocusLayout = 'A') {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const sessionId =
    kind === 'mr'
      ? MR_SESSION
      : (kind === 'local'
          ? await ipc.sessionOpenLocal({ kind: 'staged' })
          : await ipc.sessionOpenCommit({ to: 'a3f9c12' })
        ).sessionId;
  const app = renderApp({ screen: 'S-03', sessionId }, ipc);
  await app.router.navigate(`/session/${sessionId}/step?step=s4`);
  expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
  if (layout !== 'A') {
    act(() => {
      useFocusStore.getState().setLayout(layout);
    });
  }
  return { ...app, ipc, sessionId };
}

const card = (title: string, root: HTMLElement = document.body) =>
  within(root).findByRole('article', { name: `Claude note: ${title}` });

describe('S-03 self-review', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-17.2 a note says Keep to fix instead of Add to drafts, Edit and keep instead of Edit and add', async () => {
    await openStep4();
    const note = await card(PENDING);
    expect(await within(note).findByRole('button', { name: 'Keep to fix' })).toBeInTheDocument();
    expect(within(note).queryByRole('button', { name: 'Add to drafts' })).toBeNull();
    expect(within(note).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    await userEvent.click(within(note).getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu', { name: /More for PendingCount/ });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Edit and keep', 'Ask Claude', 'Copy']);
  });

  it('F-17.2 Keep to fix says the note is on the list at the end; Undo takes it back', async () => {
    await openStep4();
    const note = await card(PENDING);
    await userEvent.click(await within(note).findByRole('button', { name: 'Keep to fix' }));
    expect(await within(note).findByText(KEPT)).toBeInTheDocument();
    expect(within(note).queryByText(/Added to drafts/)).toBeNull();
    await userEvent.click(within(note).getByRole('button', { name: 'Undo' }));
    expect(await within(note).findByRole('button', { name: 'Keep to fix' })).toBeInTheDocument();
    expect(within(note).queryByText(KEPT)).toBeNull();
  });

  it('F-17.2 a kept note is on the session’s fix list until Undo', async () => {
    const { ipc, sessionId } = await openStep4();
    expect(await ipc.draftsList(sessionId)).toEqual([]);
    const note = await card(PENDING);
    await userEvent.click(await within(note).findByRole('button', { name: 'Keep to fix' }));
    await within(note).findByText(KEPT);
    const list = await ipc.draftsList(sessionId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ sessionId, findingId: 'f2', publishedNoteId: null });
    expect(list[0]?.body).not.toBe('');
    await userEvent.click(within(note).getByRole('button', { name: 'Undo' }));
    await within(note).findByRole('button', { name: 'Keep to fix' });
    expect(await ipc.draftsList(sessionId)).toEqual([]);
  });

  it('F-17.2 Edit and keep opens the text first and keeps the edited text on the fix list', async () => {
    const { ipc, sessionId } = await openStep4();
    const note = await card(PENDING);
    await within(note).findByRole('button', { name: 'Keep to fix' });
    await userEvent.click(within(note).getByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit and keep' }));
    const text = within(note).getByRole('textbox', { name: 'Suggested comment' });
    await userEvent.clear(text);
    await userEvent.type(text, 'Publish a change event from the queue');
    await userEvent.click(within(note).getByRole('button', { name: 'Keep to fix' }));
    expect(await within(note).findByText(KEPT)).toBeInTheDocument();
    expect((await ipc.draftsList(sessionId)).map((d) => d.body)).toEqual([
      'Publish a change event from the queue',
    ]);
  });

  it('F-17.2 Dismiss keeps its copy in a self-review', async () => {
    await openStep4();
    const note = await card(PENDING);
    await within(note).findByRole('button', { name: 'Keep to fix' });
    await userEvent.click(within(note).getByRole('button', { name: 'Dismiss' }));
    expect(await within(note).findByText(DISMISSED)).toBeInTheDocument();
  });

  it('F-17.2 a session of commits is a self-review too: Keep to fix, Edit and keep', async () => {
    await openStep4('commit');
    const note = await card(PENDING);
    await userEvent.click(await within(note).findByRole('button', { name: 'Keep to fix' }));
    expect(await within(note).findByText(KEPT)).toBeInTheDocument();
    expect(within(note).queryByRole('button', { name: 'Add to drafts' })).toBeNull();
  });

  it('F-17.2 layout B: the note under its line says Keep to fix', async () => {
    await openStep4('local', 'B');
    const note = await card(PENDING);
    await userEvent.click(await within(note).findByRole('button', { name: 'Keep to fix' }));
    expect(await within(note).findByText(KEPT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to drafts' })).toBeNull();
  });

  it('F-17.2 layout C: the guide’s note says Keep to fix and Edit and keep; the row of a kept note says "to fix"', async () => {
    await openStep4('local', 'C');
    const guide = await screen.findByRole('complementary', { name: 'Guide' });
    const note = await card(PENDING, guide);
    await userEvent.click(await within(note).findByRole('button', { name: 'Keep to fix' }));
    expect(await within(note).findByText(KEPT)).toBeInTheDocument();
    expect(within(guide).queryByRole('button', { name: 'Add to drafts' })).toBeNull();

    await userEvent.click(within(guide).getByRole('button', { name: `Note 1: ${PHOTO}` }));
    const row = within(guide).getByRole('button', { name: `Note 2: ${PENDING}` });
    expect(within(row).getByText('to fix')).toBeInTheDocument();
    expect(within(guide).queryByText('in drafts')).toBeNull();
    const first = await card(PHOTO, guide);
    await userEvent.click(within(first).getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Edit and keep' })).toBeInTheDocument();
  });

  it('F-17.2 layout B: the answer card under the step header says Keep to fix', async () => {
    const { ipc, sessionId } = await openStep4('local', 'B');
    await userEvent.click(screen.getByRole('button', { name: 'Ask Claude' }));
    const answer = await screen.findByRole('article', { name: 'Claude answer' });
    await userEvent.type(
      within(answer).getByRole('textbox', { name: 'Ask Claude about this step' }),
      'Why a queue?{Enter}',
    );
    await userEvent.click(await within(answer).findByRole('button', { name: 'Keep to fix' }));
    expect(await within(answer).findByText(KEPT)).toBeInTheDocument();
    expect(within(answer).queryByRole('button', { name: 'Add to drafts' })).toBeNull();
    expect(await ipc.draftsList(sessionId)).toHaveLength(1);
  });

  it('F-17.2 layout C: the answer card in the guide says Keep to fix', async () => {
    await openStep4('local', 'C');
    const guide = await screen.findByRole('complementary', { name: 'Guide' });
    await userEvent.type(
      within(guide).getByRole('textbox', { name: 'Ask Claude about this step' }),
      'Why a queue?{Enter}',
    );
    const answer = await within(guide).findByRole('article', { name: 'Claude answer' });
    await userEvent.click(await within(answer).findByRole('button', { name: 'Keep to fix' }));
    expect(await within(answer).findByText(KEPT)).toBeInTheDocument();
    expect(within(answer).queryByRole('button', { name: 'Add to drafts' })).toBeNull();
  });

  it('F-17.2 no thread icon or card and no publish, approve, resolve or reply control is shown', async () => {
    await openStep4();
    const note = await card(PENDING);
    await within(note).findByRole('button', { name: 'Keep to fix' });
    // Step 4 holds a GitLab thread at line 48 in a merge request; a self-review has no threads.
    expect(screen.queryByRole('button', { name: /^Thread by / })).toBeNull();
    expect(screen.queryByRole('region', { name: /^Thread at line/ })).toBeNull();
    expect(screen.queryByRole('button', { name: WORKFLOW })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: WORKFLOW })).toBeNull();
  });

  it('F-17.2 a merge request session keeps Add to drafts, Edit and add and its thread icons', async () => {
    await openStep4('mr');
    const note = await card(PENDING);
    expect(await within(note).findByRole('button', { name: 'Add to drafts' })).toBeInTheDocument();
    expect(within(note).queryByRole('button', { name: 'Keep to fix' })).toBeNull();
    await userEvent.click(within(note).getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Edit and add' })).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Thread by Paweł S. at line 48' }),
    ).toBeInTheDocument();
  });
});
