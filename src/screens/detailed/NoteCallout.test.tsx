import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { FINDINGS } from '../../ipc/mock/fixtures/review';
import type { Finding } from '../../ipc/types/Finding';
import type { SessionMr } from '../../ipc/types/SessionMr';
import { renderWithIpc } from '../../test/render';
import { renderApp } from '../../test/renderApp';
import { NoteCallout } from './NoteCallout';

// F-08.6: S-04's full note callout (Main.dc.html, role region "Claude note at this line"), under
// the focused note's line in the diff: number, severity tag, title, Claude label, body, "Checked
// in" evidence chips, the "Suggested comment" block and Add to drafts (D), Edit and add, Ask Claude,
// Dismiss (X); the F-09.3 confirmations with Undo; self-review Keep to fix / Edit and keep (M4
// decision 12).

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const CALLOUT = 'Claude note at this line';
const PHOTO = 'The whole photo goes into SQLite as byte[]';
const PENDING = 'PendingCount won’t refresh after upload';
const BODY =
  'The counter is only computed when adding. UploadWorker from step 3 removes items from the queue but never notifies the ViewModel, so the offline banner will show a stale number.';
const SUGGESTED =
  'Could IUploadQueue publish changes (an event or WeakReferenceMessenger) so the ViewModel refreshes PendingCount after each upload?';
const ADDED = 'Added to drafts. It reaches GitLab only when you publish.';
const DISMISSED = "Dismissed. Claude won't raise it again for this commit.";
const KEPT = "Kept to fix. It's on your list at the end.";
const DECISION = /^(Add to drafts|Keep to fix|Edit and add|Edit and keep|Dismiss)/;

/** A mock backend of its own, with the session's plan prepared as S-02 does. */
async function backend(kind: 'mr' | 'commit' = 'mr') {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const sessionId =
    kind === 'mr' ? SESSION : (await ipc.sessionOpenCommit({ to: 'a3f9c12' })).sessionId;
  await ipc.reviewPlan(sessionId, () => undefined);
  return { ipc, sessionId };
}

/** S-04 on step 4 (!482's SendPhoto, notes f1-f4 at L46, L49, L51, L54). */
async function openDetailed(client: Partial<IpcClient>, sessionId = SESSION) {
  const app = renderApp({ screen: 'S-04', sessionId }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId })}?step=s4`);
  await screen.findByRole('heading', { level: 1 });
  return app;
}

const callout = () => screen.findByRole('region', { name: CALLOUT });
const button = (root: HTMLElement, name: string | RegExp) =>
  within(root).getByRole('button', { name });
const squash = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();

function pendingNote(): Finding {
  const finding = FINDINGS.find((f) => f.id === 'f2');
  if (!finding) throw new Error('fixture note f2 missing');
  return finding;
}

describe('S-04 note callout (F-08.6)', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows. A measured
    // diff row (`data-index`) is one line high and the column is tall, so all of step 4's lines
    // (the notes sit at L46-L54) render.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-08.6 the focused note’s callout sits under its line: number, tag, title, Claude label, body, Checked in, Suggested comment', async () => {
    const { ipc } = await backend();
    await openDetailed(ipc);
    // Step 4 opens on its first Should fix (note 2, L49), as S-03 does; one callout at a time.
    const note = await callout();
    expect(screen.getAllByRole('region', { name: CALLOUT })).toHaveLength(1);
    expect(within(note).getByText('2', { exact: true })).toBeInTheDocument();
    expect(within(note).getByText('Should fix', { exact: true })).toBeInTheDocument();
    expect(within(note).getByText(PENDING)).toBeInTheDocument();
    expect(within(note).getByText('Claude', { exact: true })).toBeInTheDocument();
    expect(within(note).getByText(BODY)).toBeInTheDocument();
    expect(within(note).getByText('Checked in', { exact: true })).toBeInTheDocument();
    const chip = within(note).getByText('Uploads/UploadWorker.cs:58', { exact: true });
    expect(chip).toHaveAttribute(
      'title',
      'src/Mobile.Infrastructure/Uploads/UploadWorker.cs:58 · removes the item',
    );
    expect(within(note).getByText('Suggested comment', { exact: true })).toBeInTheDocument();
    expect(within(note).getByText(SUGGESTED)).toBeInTheDocument();

    // In the view model's diff, right under the row of line 49 (where note 2's mark sits).
    const file = screen.getByRole('region', { name: VM });
    expect(file).toContainElement(note);
    const rows = Array.from(file.querySelectorAll('[data-index]'));
    const at = rows.findIndex((row) => row.contains(note));
    expect(at).toBeGreaterThan(0);
    expect(rows[at - 1]?.querySelector('[data-kind="add"] [data-line-no="49"]')).not.toBeNull();
  });

  it('F-08.6 the callout’s actions: Add to drafts (D), Edit and add, Ask Claude, Dismiss (X)', async () => {
    const { ipc } = await backend();
    await openDetailed(ipc);
    const note = await callout();
    expect(
      within(note)
        .getAllByRole('button')
        .map((b) => squash(b.textContent)),
    ).toEqual([
      expect.stringMatching(/^Add to drafts ?D$/),
      'Edit and add',
      'Ask Claude',
      expect.stringMatching(/^Dismiss ?X$/),
    ]);
    expect(Array.from(note.querySelectorAll('kbd')).map((k) => k.textContent)).toEqual(['D', 'X']);
    expect(within(button(note, /^Add to drafts/)).getByText('D')).toBeInTheDocument();
    expect(within(button(note, /^Dismiss/)).getByText('X')).toBeInTheDocument();
  });

  it('F-08.6 Add to drafts says where the draft goes; Undo takes it back', async () => {
    const { ipc } = await backend();
    await openDetailed(ipc);
    const note = await callout();
    await userEvent.click(button(note, /^Add to drafts/));
    expect(await within(note).findByText(ADDED)).toBeInTheDocument();
    expect(button(note, 'Undo')).toHaveFocus();
    expect(within(note).queryByRole('button', { name: /^Add to drafts/ })).toBeNull();
    const drafts = await ipc.draftsList(SESSION);
    expect(drafts.map((d) => [d.findingId, d.body])).toEqual([['f2', SUGGESTED]]);

    await userEvent.click(button(note, 'Undo'));
    expect(await within(note).findByRole('button', { name: /^Add to drafts/ })).toHaveFocus();
    expect(within(note).queryByText(ADDED)).toBeNull();
    expect(await ipc.draftsList(SESSION)).toEqual([]);
  });

  it('F-08.6 Dismiss says Claude won’t raise it again; Undo brings the actions back', async () => {
    const { ipc } = await backend();
    await openDetailed(ipc);
    const note = await callout();
    await userEvent.click(button(note, /^Dismiss/));
    expect(await within(note).findByText(DISMISSED)).toBeInTheDocument();
    expect(within(note).queryByRole('button', { name: DECISION })).toBeNull();
    // The callout stays on the decided note.
    expect(within(note).getByText(PENDING)).toBeInTheDocument();

    await userEvent.click(button(note, 'Undo'));
    expect(await within(note).findByRole('button', { name: /^Dismiss/ })).toBeInTheDocument();
    expect(within(note).queryByText(DISMISSED)).toBeNull();
    expect(await ipc.draftsList(SESSION)).toEqual([]);
  });

  it('F-08.6 Edit and add opens the suggested comment for editing; Cancel drops it, Add to drafts sends the edit', async () => {
    const { ipc } = await backend();
    await openDetailed(ipc);
    const note = await callout();
    await userEvent.click(button(note, 'Edit and add'));
    const text = within(note).getByRole('textbox', { name: 'Suggested comment' });
    expect(text).toHaveFocus();
    expect(text).toHaveValue(SUGGESTED);
    await userEvent.click(button(note, 'Cancel'));
    expect(within(note).queryByRole('textbox', { name: 'Suggested comment' })).toBeNull();
    expect(await ipc.draftsList(SESSION)).toEqual([]);

    await userEvent.click(button(note, 'Edit and add'));
    const again = within(note).getByRole('textbox', { name: 'Suggested comment' });
    expect(again).toHaveValue(SUGGESTED);
    await userEvent.clear(again);
    await userEvent.type(again, 'Refresh PendingCount after each upload?');
    await userEvent.click(button(note, /^Add to drafts/));
    expect(await within(note).findByText(ADDED)).toBeInTheDocument();
    expect(await ipc.draftsList(SESSION)).toMatchObject([
      { findingId: 'f2', body: 'Refresh PendingCount after each upload?' },
    ]);
  });

  it('F-08.6 the other notes are numbered marks on their lines; a click on one moves the callout there', async () => {
    const { ipc } = await backend();
    await openDetailed(ipc);
    await callout();
    const file = screen.getByRole('region', { name: VM });
    const marks = within(file).getAllByRole('button', { name: /^Note \d: / });
    expect(marks.map((m) => m.textContent)).toEqual(['1', '2', '3', '4']);
    expect(button(file, `Note 2: ${PENDING}`)).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(button(file, `Note 1: ${PHOTO}`));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: CALLOUT })).toHaveTextContent(PHOTO);
    });
    const note = screen.getByRole('region', { name: CALLOUT });
    expect(screen.getAllByRole('region', { name: CALLOUT })).toHaveLength(1);
    expect(within(note).getByText('Question', { exact: true })).toBeInTheDocument();
    expect(
      within(note).getByText('Uploads/PendingUpload.cs:5', { exact: true }),
    ).toBeInTheDocument();
    expect(button(file, `Note 1: ${PHOTO}`)).toHaveAttribute('aria-pressed', 'true');
    expect(button(file, `Note 2: ${PENDING}`)).toHaveAttribute('aria-pressed', 'false');
  });

  it('F-08.6 self-review: Keep to fix (D) and Edit and keep; "Kept to fix." with Undo', async () => {
    const { ipc, sessionId } = await backend('commit');
    await openDetailed(ipc, sessionId);
    const note = await callout();
    const keep = await within(note).findByRole('button', { name: /^Keep to fix/ });
    expect(within(keep).getByText('D')).toBeInTheDocument();
    expect(button(note, 'Edit and keep')).toBeInTheDocument();
    expect(within(note).queryByRole('button', { name: /^Add to drafts/ })).toBeNull();
    expect(within(note).queryByRole('button', { name: 'Edit and add' })).toBeNull();

    await userEvent.click(button(note, 'Edit and keep'));
    expect(within(note).getByRole('textbox', { name: 'Suggested comment' })).toHaveValue(SUGGESTED);
    expect(button(note, /^Keep to fix/)).toBeInTheDocument();
    await userEvent.click(button(note, 'Cancel'));

    await userEvent.click(button(note, /^Keep to fix/));
    expect(await within(note).findByText(KEPT)).toBeInTheDocument();
    await userEvent.click(button(note, 'Undo'));
    expect(await within(note).findByRole('button', { name: /^Keep to fix/ })).toBeInTheDocument();
  });

  it('F-08.6 while the session is looked up the callout shows the note but offers no action yet', async () => {
    const { ipc } = await backend();
    await openDetailed({
      ...ipc,
      sessionMr: () => new Promise<SessionMr | null>(() => undefined),
    });
    const note = await callout();
    expect(within(note).getByText(PENDING)).toBeInTheDocument();
    expect(within(note).getByText(SUGGESTED)).toBeInTheDocument();
    // Neither the MR copy nor the self-review copy is guessed (as the info header, D-20 (3)).
    expect(within(note).queryAllByRole('button')).toEqual([]);
  });

  it('F-08.6 when the session lookup fails the callout keeps the MR copy, as S-03 does', async () => {
    const { ipc } = await backend();
    await openDetailed({
      ...ipc,
      sessionMr: () =>
        Promise.reject(
          new IpcError({
            code: 'INTERNAL',
            message: 'The session could not be read.',
            retryable: false,
          }),
        ),
    });
    const note = await callout();
    expect(await within(note).findByRole('button', { name: /^Add to drafts/ })).toBeInTheDocument();
    expect(button(note, 'Edit and add')).toBeInTheDocument();
    expect(within(note).queryByRole('button', { name: /^Keep to fix/ })).toBeNull();
  });
});

describe('NoteCallout (F-08.6)', () => {
  it('F-08.6 Checked in: one plain chip per evidence entry, last folder, file name and line; full path and Claude’s note as the tooltip', () => {
    const finding: Finding = {
      ...pendingNote(),
      evidence: [
        {
          file: 'src/Mobile.Infrastructure/Uploads/UploadWorker.cs',
          line: 58,
          note: 'removes the item',
        },
        { file: 'README.md', line: 3, note: 'the setup steps' },
      ],
    };
    renderWithIpc(
      <NoteCallout finding={finding} sessionId={SESSION} number={2} selfReview={false} />,
    );
    const note = screen.getByRole('region', { name: CALLOUT });
    const first = within(note).getByText('Uploads/UploadWorker.cs:58', { exact: true });
    const second = within(note).getByText('README.md:3', { exact: true });
    expect(first).toHaveAttribute(
      'title',
      'src/Mobile.Infrastructure/Uploads/UploadWorker.cs:58 · removes the item',
    );
    expect(second).toHaveAttribute('title', 'README.md:3 · the setup steps');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(note).queryByRole('button', { name: /UploadWorker|README/ })).toBeNull();
    expect(within(note).queryByRole('link')).toBeNull();
  });

  it('F-08.6 a note without evidence has no Checked in row', () => {
    renderWithIpc(
      <NoteCallout
        finding={{ ...pendingNote(), evidence: [] }}
        sessionId={SESSION}
        number={2}
        selfReview={false}
      />,
    );
    const note = screen.getByRole('region', { name: CALLOUT });
    expect(within(note).getByText(PENDING)).toBeInTheDocument();
    expect(within(note).queryByText('Checked in')).toBeNull();
    expect(within(note).getByText('Suggested comment', { exact: true })).toBeInTheDocument();
  });

  it('F-08.6 Ask Claude hands the note to the screen', async () => {
    const onAsk = vi.fn<(finding: Finding) => void>();
    renderWithIpc(
      <NoteCallout
        finding={pendingNote()}
        sessionId={SESSION}
        number={2}
        selfReview={false}
        onAsk={onAsk}
      />,
    );
    const note = screen.getByRole('region', { name: CALLOUT });
    await userEvent.click(button(note, 'Ask Claude'));
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ id: 'f2', line: 49 }));
  });
});
