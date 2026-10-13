import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NOTES_STEP } from '../../ipc/mock/fixtures/review';
import { mockClient, renderWithIpc } from '../../test/render';
import { StepNotes } from './StepNotes';

const SESSION = 'mock-mr-session-1';
const COUNTER = 'Claude note: PendingCount won’t refresh after upload';
const ADDED = 'Added to drafts. It reaches GitLab only when you publish.';
const DISMISSED = "Dismissed. Claude won't raise it again for this commit.";

function renderNotes(selfReview = false, onAsk = vi.fn()) {
  const ipc = mockClient();
  renderWithIpc(
    <StepNotes sessionId={SESSION} stepId={NOTES_STEP} selfReview={selfReview} onAsk={onAsk} />,
    ipc,
  );
  return { ipc, onAsk };
}

const card = async (name = COUNTER) => screen.findByRole('article', { name });

describe('NoteCard', () => {
  it('F-07.6 shows the severity word, title, Claude label, body and Add to drafts, Dismiss, More', async () => {
    renderNotes();
    const note = await card();
    expect(within(note).getByText('Should fix')).toBeInTheDocument();
    expect(within(note).getByText('Claude')).toBeInTheDocument();
    expect(within(note).getByText(/UploadWorker from step 3 removes items/)).toBeInTheDocument();
    expect(within(note).getByRole('button', { name: 'Add to drafts' })).toBeInTheDocument();
    expect(within(note).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    await userEvent.click(within(note).getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu', { name: /More for PendingCount/ });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Edit and add', 'Ask Claude', 'Copy']);
    // Severity words: Question, Should fix, Minor, Should fix in diff order.
    expect(screen.getAllByText(/^(Question|Should fix|Minor)$/).map((t) => t.textContent)).toEqual([
      'Question',
      'Should fix',
      'Minor',
      'Should fix',
    ]);
  });

  it('F-09.2 Add to drafts creates a draft from the suggested comment; Undo takes it back', async () => {
    const { ipc } = renderNotes();
    const note = await card();
    await userEvent.click(within(note).getByRole('button', { name: 'Add to drafts' }));
    expect(await within(note).findByText(ADDED)).toBeInTheDocument();
    expect(within(note).getByRole('button', { name: 'Undo' })).toHaveFocus();
    const drafts = await ipc.draftsList(SESSION);
    expect(drafts.map((d) => d.findingId)).toEqual(['f2']);
    expect(drafts[0]?.body).toMatch(/^Could IUploadQueue/);

    await userEvent.click(within(note).getByRole('button', { name: 'Undo' }));
    expect(await within(note).findByRole('button', { name: 'Add to drafts' })).toBeInTheDocument();
    expect(await ipc.draftsList(SESSION)).toEqual([]);
  });

  it('F-09.2 Edit and add opens the suggested comment for editing first', async () => {
    const { ipc } = renderNotes();
    const note = await card();
    await userEvent.click(within(note).getByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit and add' }));
    const text = within(note).getByRole('textbox', { name: 'Suggested comment' });
    expect(text).toHaveFocus();
    expect(text).toHaveValue(
      'Could IUploadQueue publish changes (an event or WeakReferenceMessenger) so the ViewModel refreshes PendingCount after each upload?',
    );
    await userEvent.clear(text);
    await userEvent.type(text, 'Refresh PendingCount after each upload?');
    await userEvent.click(within(note).getByRole('button', { name: 'Add to drafts' }));
    expect(await within(note).findByText(ADDED)).toBeInTheDocument();
    expect(await ipc.draftsList(SESSION)).toMatchObject([
      { findingId: 'f2', body: 'Refresh PendingCount after each upload?' },
    ]);
  });

  it('F-09.2 Edit and add with an empty comment cannot be sent; Cancel goes back', async () => {
    renderNotes();
    const note = await card();
    await userEvent.click(within(note).getByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit and add' }));
    await userEvent.clear(within(note).getByRole('textbox', { name: 'Suggested comment' }));
    expect(within(note).getByRole('button', { name: 'Add to drafts' })).toBeDisabled();
    await userEvent.click(within(note).getByRole('button', { name: 'Cancel' }));
    expect(within(note).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(note).getByRole('button', { name: 'Dismiss' })).toBeEnabled();
  });

  it('F-09.2 Dismiss and Undo; the dismissed title is struck through', async () => {
    renderNotes();
    const note = await card('Claude note: Status texts are hardcoded');
    await userEvent.click(within(note).getByRole('button', { name: 'Dismiss' }));
    expect(await within(note).findByText(DISMISSED)).toBeInTheDocument();
    expect(within(note).getByText('Status texts are hardcoded').className).toMatch(
      /titleDismissed/,
    );
    await userEvent.click(within(note).getByRole('button', { name: 'Undo' }));
    expect(await within(note).findByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('F-09.3 says where a draft goes and that a dismissal sticks for this commit', async () => {
    renderNotes();
    const first = await card('Claude note: The whole photo goes into SQLite as byte[]');
    await userEvent.click(within(first).getByRole('button', { name: 'Add to drafts' }));
    expect(await within(first).findByText(ADDED)).toBeInTheDocument();
    const last = await card('Claude note: catch (Exception) also catches camera cancellation');
    await userEvent.click(within(last).getByRole('button', { name: 'Dismiss' }));
    expect(await within(last).findByText(DISMISSED)).toBeInTheDocument();
  });

  it('F-09.3 self-review copy: Keep to fix, Edit and keep, "Kept to fix."', async () => {
    renderNotes(true);
    const note = await card();
    await userEvent.click(within(note).getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Edit and keep' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(note).getByRole('button', { name: 'Keep to fix' }));
    expect(
      await within(note).findByText("Kept to fix. It's on your list at the end."),
    ).toBeInTheDocument();
  });

  it('F-10.1 More › Ask Claude hands the note to the screen; Copy copies the suggested comment', async () => {
    const user = userEvent.setup();
    const { onAsk } = renderNotes();
    const note = await card();
    await user.click(within(note).getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ask Claude' }));
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ id: 'f2', line: 49 }));
    await user.click(within(note).getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }));
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toMatch(/^Could IUploadQueue publish changes/);
    });
  });
});
