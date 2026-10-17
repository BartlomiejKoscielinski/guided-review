import { act, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { createQueryClient } from '../../app/queryClient';
import { createAppRouter } from '../../app/router';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { IpcProvider } from '../../ipc/IpcProvider';
import { createMockClient } from '../../ipc/mock';
import type { DiffPosition } from '../../ipc/types/DiffPosition';
import type { Route } from '../../ipc/types/Route';
import type { Severity } from '../../ipc/types/Severity';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-12.3: the Drafts tab of S-05 of an MR session (SummaryDesk.dc.html): the note "Only you can see
// drafts until you publish them.", then one row per draft with a blue checkbox "Publish comment N"
// (include in publish), the severity square, the text, `file:line` and the pencil "Edit comment N".
// M5 decision 6: no square without a severity, "general comment" without a position, the pencil
// turns the text into a text area with Save and Cancel (Ctrl+Enter, Esc) that saves locally only,
// published rows stay with "· published", a ticked and locked checkbox and no pencil.
//
// Locators the screen keeps: the tab's panel (role tabpanel) holds the rows as list items; a row
// holds the checkbox, the severity square (its word as `visually-hidden` text, as KeptNote draws
// the self-review list), the pencil, and while it is edited one textbox with Save and Cancel. Drafts are made through draftsCreate of
// the mock backend, so draftsUpdate really changes them.

const MR_SESSION = 'mock-mr-session-1';
/** Commands that may run Claude or call GitLab; a restored S-05 calls none of them (F-30.4). */
const WORK = /^(review|gitlab|claude(?!Status$|Models$))/;
const DOT = '·';
const NOTE = 'Only you can see drafts until you publish them.';
/** The words of the severity tags (noteCopy), the square's hidden text. */
const SEVERITY_WORDS = /^(Should fix|Question|Minor)$/;

const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const WORKER = 'src/Mobile.Infrastructure/Uploads/UploadWorker.cs';
const PENDING = 'src/Mobile.Core/Uploads/PendingUpload.cs';
const PAGE = 'src/Mobile.App/Views/DeliveryPhotoPage.xaml';

interface Seed {
  severity: Severity | null;
  body: string;
  position: DiffPosition | null;
}

const at = (file: string, line: number): DiffPosition => ({ file, side: 'new', line });

/** The five drafts of the design mock (SummaryDesk.dc.html): severity, text and file:line. */
const MOCK_DRAFTS: readonly Seed[] = [
  {
    severity: 'fix',
    body: 'Consider a separate catch (OperationCanceledException) without a message. Closing the camera isn’t a save error.',
    position: at(VM, 54),
  },
  {
    severity: 'fix',
    body: 'PendingCount doesn’t refresh after the worker uploads. Maybe a Changed event on IUploadQueue?',
    position: at(VM, 49),
  },
  {
    severity: 'fix',
    body: 'Retries have no upper limit. On a permanent 4xx the photo will be retried forever.',
    position: at(WORKER, 71),
  },
  {
    severity: 'q',
    body: 'Did we consider saving the photo to disk and keeping only the path in the queue?',
    position: at(PENDING, 5),
  },
  {
    severity: 'nit',
    body: 'Nit: the banner has a fixed height. With a larger system font the text gets clipped.',
    position: at(PAGE, 41),
  },
];

/** The mock locations of MOCK_DRAFTS, as the rows read them. */
const MOCK_LOCS = [
  'DeliveryPhotoViewModel.cs:54',
  'DeliveryPhotoViewModel.cs:49',
  'UploadWorker.cs:71',
  'PendingUpload.cs:5',
  'DeliveryPhotoPage.xaml:41',
];

/** The mock backend of an MR session whose plan is read and whose drafts were really made. */
async function mrBackend(seeds: readonly Seed[] = MOCK_DRAFTS): Promise<IpcClient> {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  for (const seed of seeds) {
    await base.draftsCreate({ sessionId: MR_SESSION, findingId: null, ...seed });
  }
  return { ...base };
}

/** The whole app on `start`. */
function mountApp(start: Route, client: IpcClient) {
  const router = createAppRouter(start);
  const view = render(
    <IpcProvider client={client}>
      <QueryClientProvider client={createQueryClient()}>
        <App router={router} />
      </QueryClientProvider>
    </IpcProvider>,
  );
  return { router, ...view };
}

/** S-05 of the MR session, opened the way Finish review does (not restored on start). */
async function openSummary(client: IpcClient) {
  const app = mountApp({ screen: 'S-01' }, client);
  await act(() => app.router.navigate(`/session/${MR_SESSION}/summary`));
  return app;
}

const draftIds = async (client: IpcClient) =>
  (await client.draftsList(MR_SESSION)).map((d) => d.id);

/** The panel of the selected tab, once the summary has chosen its tab. */
const panel = () => screen.findByRole('tabpanel');
const listRows = () => within(screen.getByRole('tabpanel')).queryAllByRole('listitem');
/** Row `n` (1-based) of the list; the rows must be on screen already. */
const rowAt = (n: number): HTMLElement => {
  const row = listRows()[n - 1];
  if (!row) throw new Error(`The list has no row ${String(n)}.`);
  return row;
};
const boxOf = (n: number) =>
  within(rowAt(n)).getByRole('checkbox', { name: `Publish comment ${String(n)}` });
const pencilOf = (n: number) =>
  within(rowAt(n)).getByRole('button', { name: `Edit comment ${String(n)}` });
const editorOf = (n: number) => within(rowAt(n)).getByRole('textbox');
const buttonIn = (n: number, name: string) => within(rowAt(n)).getByRole('button', { name });

/** Opens the summary on the Drafts tab and waits for its rows. */
async function openDrafts(client: IpcClient) {
  const app = await openSummary(client);
  await within(await panel()).findAllByRole('listitem');
  return app;
}

/** A failed command, the way the core answers (an AppError carried by IpcError). */
const refused = (message: string, code: 'CONFLICT' | 'INTERNAL' = 'CONFLICT') =>
  new IpcError({ code, message, retryable: false });

describe('S-05 Drafts list (F-12.3)', () => {
  it('F-12.3 the Drafts tab lists the five drafts of the mock in order: ticked "Publish comment N" checkbox, text, file:line, "Edit comment N" pencil', async () => {
    await openDrafts(await mrBackend());
    expect(listRows()).toHaveLength(5);
    MOCK_DRAFTS.forEach((draft, index) => {
      const n = index + 1;
      const row = rowAt(n);
      expect(within(row).getByText(draft.body)).toBeInTheDocument();
      expect(row).toHaveTextContent(MOCK_LOCS[index] ?? '');
      expect(boxOf(n)).toBeChecked();
      expect(boxOf(n)).toBeEnabled();
      expect(pencilOf(n)).toHaveAttribute('title', 'Edit');
    });
  });

  it('F-12.3 the order of the rows is the order the drafts were made in', async () => {
    const reversed = [...MOCK_DRAFTS].reverse();
    await openDrafts(await mrBackend(reversed));
    reversed.forEach((draft, index) => {
      expect(within(rowAt(index + 1)).getByText(draft.body)).toBeInTheDocument();
    });
  });

  it('F-12.3 file:line shows the file name only and carries the full path in its title, with spaces and Polish characters whole', async () => {
    const polish = 'src/Widoki/Zdjęcie dostawy.cs';
    await openDrafts(
      await mrBackend([
        MOCK_DRAFTS[0] as Seed,
        {
          severity: 'q',
          body: 'Nazwa pliku ze spacją i polskim znakiem.',
          position: at(polish, 7),
        },
        {
          severity: 'nit',
          body: 'A file in the root of the repository.',
          position: at('README.md', 1),
        },
      ]),
    );
    const first = within(rowAt(1)).getByTitle((title) => title.includes(VM));
    expect(first).toHaveTextContent('DeliveryPhotoViewModel.cs:54');
    expect(first.textContent).not.toContain('src/');

    const second = within(rowAt(2)).getByTitle((title) => title.includes(polish));
    expect(second).toHaveTextContent('Zdjęcie dostawy.cs:7');
    expect(second.textContent).not.toContain('Widoki');

    expect(rowAt(3)).toHaveTextContent('README.md:1');
  });

  it('F-12.3 a draft without a position says "general comment" in place of file:line', async () => {
    await openDrafts(
      await mrBackend([
        MOCK_DRAFTS[0] as Seed,
        { severity: null, body: 'Thanks, the offline queue looks good overall.', position: null },
      ]),
    );
    expect(within(rowAt(2)).getByText('general comment')).toBeInTheDocument();
    expect(
      within(rowAt(2)).getByText('Thanks, the offline queue looks good overall.'),
    ).toBeVisible();
    expect(within(rowAt(1)).queryByText('general comment')).toBeNull();
  });

  it('F-12.3 the severity square carries the word of the note card (Should fix, Question, Minor) as hidden text, one per draft', async () => {
    await openDrafts(await mrBackend());
    const words = ['Should fix', 'Should fix', 'Should fix', 'Question', 'Minor'];
    words.forEach((word, index) => {
      const found = within(rowAt(index + 1)).getAllByText(SEVERITY_WORDS);
      expect(found).toHaveLength(1);
      expect(found[0]).toHaveTextContent(word);
      // The square is drawn without a word, as in the mock and in the self-review list.
      expect(found[0]).toHaveClass('visually-hidden');
    });
  });

  it('F-12.3 a draft without a severity has no square, with or without a line, and its row is still a full row', async () => {
    await openDrafts(
      await mrBackend([
        { severity: null, body: 'An answer from Ask Claude.', position: at(VM, 12) },
        { severity: null, body: 'A free comment on the whole MR.', position: null },
        MOCK_DRAFTS[3] as Seed,
      ]),
    );
    expect(within(rowAt(1)).queryAllByText(SEVERITY_WORDS)).toHaveLength(0);
    expect(within(rowAt(2)).queryAllByText(SEVERITY_WORDS)).toHaveLength(0);
    expect(within(rowAt(3)).getAllByText(SEVERITY_WORDS)).toHaveLength(1);
    expect(rowAt(1)).toHaveTextContent('DeliveryPhotoViewModel.cs:12');
    expect(boxOf(1)).toBeChecked();
    expect(pencilOf(2)).toBeInTheDocument();
  });

  it('F-12.3 the note "Only you can see drafts until you publish them." stands above the list, on the Drafts tab only', async () => {
    await openDrafts(await mrBackend());
    const note = within(await panel()).getByText(NOTE);
    expect(note.compareDocumentPosition(rowAt(1)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: /^Threads/ }));
    expect(screen.queryByText(NOTE)).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Drafts 5' }));
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    expect(listRows()).toHaveLength(5);
  });

  it('F-12.3 a session without drafts says "No drafts yet." on the Drafts tab and lists no row', async () => {
    await openSummary(await mrBackend([]));
    await userEvent.click(await screen.findByRole('tab', { name: 'Drafts 0' }));
    expect(await within(await panel()).findByText('No drafts yet.')).toBeInTheDocument();
    expect(listRows()).toHaveLength(0);
  });

  it('F-12.3 when the drafts cannot be read the Drafts tab says why in an alert and lists nothing', async () => {
    const client = await mrBackend();
    vi.spyOn(client, 'draftsList').mockRejectedValue(
      refused('The drafts could not be read.', 'INTERNAL'),
    );
    await openSummary(client);
    const alert = await within(await panel()).findByRole('alert');
    expect(alert).toHaveTextContent('The drafts could not be read.');
    expect(listRows()).toHaveLength(0);
    expect(screen.queryByText('No drafts yet.')).toBeNull();
  });
});

describe('S-05 include in publish (F-12.3)', () => {
  it('F-12.3 unticking a draft sends drafts_update with include false and no new body; the row shows it unticked and Drafts keeps its count', async () => {
    const client = await mrBackend();
    const update = vi.spyOn(client, 'draftsUpdate');
    const ids = await draftIds(client);
    await openDrafts(client);

    await userEvent.click(boxOf(2));
    await waitFor(() => {
      expect(boxOf(2)).not.toBeChecked();
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(ids[1], { body: null, include: false });
    expect(boxOf(1)).toBeChecked();
    expect(boxOf(3)).toBeChecked();
    // The unticked draft is still a draft: its text and pencil stay, the tab still counts it.
    expect(within(rowAt(2)).getByText(MOCK_DRAFTS[1]?.body ?? '')).toBeInTheDocument();
    expect(pencilOf(2)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Drafts 5' })).toBeInTheDocument();
  });

  it('F-12.3 the ticked state persists: opened again the summary shows the unticked draft unticked, and ticking it sends include true', async () => {
    const client = await mrBackend();
    const update = vi.spyOn(client, 'draftsUpdate');
    const ids = await draftIds(client);
    const first = await openDrafts(client);
    await userEvent.click(boxOf(4));
    await waitFor(() => {
      expect(boxOf(4)).not.toBeChecked();
    });
    first.unmount();

    await openDrafts(client);
    expect(boxOf(4)).not.toBeChecked();
    expect(boxOf(3)).toBeChecked();
    await userEvent.click(boxOf(4));
    await waitFor(() => {
      expect(boxOf(4)).toBeChecked();
    });
    expect(update).toHaveBeenLastCalledWith(ids[3], { body: null, include: true });
  });

  it('F-12.3 a refused include leaves the checkbox as it was and says why in an alert', async () => {
    const client = await mrBackend();
    vi.spyOn(client, 'draftsUpdate').mockRejectedValue(
      refused('This draft is already on GitLab; change it there.'),
    );
    await openDrafts(client);

    await userEvent.click(boxOf(2));
    const alert = await within(await panel()).findByRole('alert');
    expect(alert).toHaveTextContent('This draft is already on GitLab; change it there.');
    expect(boxOf(2)).toBeChecked();
  });
});

describe('S-05 editing a draft in place (F-12.3, M5 decision 6)', () => {
  it('F-12.3 the pencil turns the text into a text area holding the draft, with Save and Cancel, and puts the focus in it', async () => {
    await openDrafts(await mrBackend());
    expect(within(rowAt(2)).queryByRole('textbox')).toBeNull();

    await userEvent.click(pencilOf(2));
    const editor = editorOf(2);
    expect(editor).toHaveValue(MOCK_DRAFTS[1]?.body);
    expect(editor).toHaveFocus();
    expect(buttonIn(2, 'Save')).toBeEnabled();
    expect(buttonIn(2, 'Cancel')).toBeEnabled();
    // Only the edited row changes.
    expect(within(rowAt(1)).queryByRole('textbox')).toBeNull();
    expect(within(rowAt(3)).queryByRole('textbox')).toBeNull();
    expect(within(rowAt(1)).getByText(MOCK_DRAFTS[0]?.body ?? '')).toBeInTheDocument();
  });

  it('F-12.3 Save sends drafts_update with the new body only, shows the new text and closes the editor; an unticked draft stays unticked', async () => {
    const client = await mrBackend();
    const update = vi.spyOn(client, 'draftsUpdate');
    const ids = await draftIds(client);
    await openDrafts(client);
    await userEvent.click(boxOf(3));
    await waitFor(() => {
      expect(boxOf(3)).not.toBeChecked();
    });
    update.mockClear();

    await userEvent.click(pencilOf(3));
    const editor = editorOf(3);
    await userEvent.clear(editor);
    await userEvent.type(editor, 'Cap the retries at five and give up on a 4xx.');
    await userEvent.click(buttonIn(3, 'Save'));

    await waitFor(() => {
      expect(within(rowAt(3)).queryByRole('textbox')).toBeNull();
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(ids[2], {
      body: 'Cap the retries at five and give up on a 4xx.',
      include: null,
    });
    expect(
      within(rowAt(3)).getByText('Cap the retries at five and give up on a 4xx.'),
    ).toBeInTheDocument();
    expect(within(rowAt(3)).queryByText(MOCK_DRAFTS[2]?.body ?? '')).toBeNull();
    expect(boxOf(3)).not.toBeChecked();
    expect(pencilOf(3)).toHaveFocus();
    // It is a new text for the same draft: nothing else moved.
    expect(listRows()).toHaveLength(5);
    expect(rowAt(3)).toHaveTextContent('UploadWorker.cs:71');
    expect(within(rowAt(4)).getByText(MOCK_DRAFTS[3]?.body ?? '')).toBeInTheDocument();
  });

  it('F-12.3 Ctrl+Enter saves like Save', async () => {
    const client = await mrBackend();
    const update = vi.spyOn(client, 'draftsUpdate');
    const ids = await draftIds(client);
    await openDrafts(client);

    await userEvent.click(pencilOf(1));
    await userEvent.type(editorOf(1), ' Thanks!');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(ids[0], {
        body: `${MOCK_DRAFTS[0]?.body ?? ''} Thanks!`,
        include: null,
      });
    });
    await waitFor(() => {
      expect(within(rowAt(1)).queryByRole('textbox')).toBeNull();
    });
    expect(within(rowAt(1)).getByText(/ Thanks!$/)).toBeInTheDocument();
  });

  it('F-12.3 Esc cancels: nothing is sent, the old text is back and the focus returns to the pencil', async () => {
    const client = await mrBackend();
    const update = vi.spyOn(client, 'draftsUpdate');
    await openDrafts(client);

    await userEvent.click(pencilOf(2));
    await userEvent.clear(editorOf(2));
    await userEvent.type(editorOf(2), 'Something else entirely.');
    await userEvent.keyboard('{Escape}');

    expect(within(rowAt(2)).queryByRole('textbox')).toBeNull();
    expect(within(rowAt(2)).getByText(MOCK_DRAFTS[1]?.body ?? '')).toBeInTheDocument();
    expect(screen.queryByText('Something else entirely.')).toBeNull();
    expect(pencilOf(2)).toHaveFocus();
    expect(update).not.toHaveBeenCalled();

    // Opened again, the editor starts from the saved text, not from the abandoned one.
    await userEvent.click(pencilOf(2));
    expect(editorOf(2)).toHaveValue(MOCK_DRAFTS[1]?.body);
  });

  it('F-12.3 Cancel does what Esc does', async () => {
    const client = await mrBackend();
    const update = vi.spyOn(client, 'draftsUpdate');
    await openDrafts(client);

    await userEvent.click(pencilOf(5));
    await userEvent.type(editorOf(5), ' More words.');
    await userEvent.click(buttonIn(5, 'Cancel'));

    expect(within(rowAt(5)).queryByRole('textbox')).toBeNull();
    expect(within(rowAt(5)).getByText(MOCK_DRAFTS[4]?.body ?? '')).toBeInTheDocument();
    expect(pencilOf(5)).toHaveFocus();
    expect(update).not.toHaveBeenCalled();
  });

  it('F-12.3 a blank text cannot be saved: Save is disabled and Ctrl+Enter sends nothing', async () => {
    const client = await mrBackend();
    const update = vi.spyOn(client, 'draftsUpdate');
    await openDrafts(client);

    await userEvent.click(pencilOf(1));
    await userEvent.clear(editorOf(1));
    expect(buttonIn(1, 'Save')).toBeDisabled();
    await userEvent.type(editorOf(1), '   ');
    expect(buttonIn(1, 'Save')).toBeDisabled();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    expect(update).not.toHaveBeenCalled();
    expect(within(rowAt(1)).getByRole('textbox')).toBeInTheDocument();
  });

  it('F-12.3 a refused save keeps the editor open with the typed text and says why in an alert', async () => {
    const client = await mrBackend();
    vi.spyOn(client, 'draftsUpdate').mockRejectedValue(
      refused('This draft is already on GitLab; change it there.'),
    );
    await openDrafts(client);

    await userEvent.click(pencilOf(2));
    await userEvent.clear(editorOf(2));
    await userEvent.type(editorOf(2), 'My careful rewrite.');
    await userEvent.click(buttonIn(2, 'Save'));

    const alert = await within(await panel()).findByRole('alert');
    expect(alert).toHaveTextContent('This draft is already on GitLab; change it there.');
    expect(editorOf(2)).toHaveValue('My careful rewrite.');
    expect(buttonIn(2, 'Save')).toBeEnabled();
  });
});

describe('S-05 published drafts (F-12.3, M5 decision 6)', () => {
  /** The mock backend where the drafts at `indexes` (0-based) are already on GitLab. */
  async function withPublished(indexes: readonly number[]) {
    const client = await mrBackend();
    const all = await client.draftsList(MR_SESSION);
    vi.spyOn(client, 'draftsList').mockResolvedValue(
      all.map((d, index) =>
        indexes.includes(index) ? { ...d, publishedNoteId: 9000 + index } : d,
      ),
    );
    return client;
  }

  it('F-12.3 a published draft keeps its row with "· published" after file:line, a ticked and locked checkbox and no pencil', async () => {
    const client = await withPublished([0, 2]);
    const update = vi.spyOn(client, 'draftsUpdate');
    await openDrafts(client);
    expect(listRows()).toHaveLength(5);

    for (const n of [1, 3]) {
      expect(rowAt(n)).toHaveTextContent(`${MOCK_LOCS[n - 1] ?? ''} ${DOT} published`);
      expect(boxOf(n)).toBeChecked();
      expect(boxOf(n)).toBeDisabled();
      expect(
        within(rowAt(n)).queryByRole('button', { name: `Edit comment ${String(n)}` }),
      ).toBeNull();
      expect(within(rowAt(n)).getByText(MOCK_DRAFTS[n - 1]?.body ?? '')).toBeInTheDocument();
    }
    // The others are still local drafts.
    for (const n of [2, 4, 5]) {
      expect(rowAt(n)).not.toHaveTextContent('published');
      expect(boxOf(n)).toBeEnabled();
      expect(pencilOf(n)).toBeInTheDocument();
    }
    await userEvent.click(boxOf(1));
    expect(update).not.toHaveBeenCalled();
    expect(boxOf(1)).toBeChecked();
  });

  it('F-12.3 one draft still local keeps the Only-you note, even when the others are published', async () => {
    const some = await withPublished([0, 1, 2, 3]);
    await openDrafts(some);
    expect(within(await panel()).getByText(NOTE)).toBeInTheDocument();
    expect(screen.queryByText('Published to GitLab.')).toBeNull();
  });

  it('F-12.3 with every draft published the note reads "Published to GitLab." instead', async () => {
    await openSummary(await withPublished([0, 1, 2, 3, 4]));
    // Nothing is left to publish, so the summary opens on Threads; the rows are one click away.
    await userEvent.click(await screen.findByRole('tab', { name: 'Drafts 5' }));
    expect(await within(await panel()).findByText('Published to GitLab.')).toBeInTheDocument();
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(listRows()).toHaveLength(5);
    for (let n = 1; n <= 5; n += 1) {
      expect(rowAt(n)).toHaveTextContent(`${DOT} published`);
    }
  });
});

describe('S-05 of a self-review keeps its own list (F-12.3, F-17.4)', () => {
  it('F-12.3 the self-review summary lists its kept notes without the Only-you note, checkboxes, pencils or tabs', async () => {
    // A guard, green before F-12.3 and after it: the Drafts tab belongs to the MR summary only.
    const ipc = createMockClient({ latencyMs: 0 });
    await ipc.repoPick();
    const { sessionId } = await ipc.sessionOpenLocal({ kind: 'staged' });
    await ipc.reviewPlan(sessionId, () => undefined);
    const kept = MOCK_DRAFTS[1] as Seed;
    await ipc.draftsCreate({ sessionId, findingId: null, ...kept });
    const app = mountApp({ screen: 'S-01' }, { ...ipc });
    await act(() => app.router.navigate(`/session/${sessionId}/summary`));

    expect(await screen.findByText(kept.body)).toBeInTheDocument();
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Edit comment/ })).toBeNull();
  });
});

describe('S-05 Drafts list restored on start (F-12.3, F-30.4)', () => {
  it('F-12.3 F-30.4 a restored S-05 lists the drafts from this PC, and ticking and editing one runs no review, GitLab or Claude command', async () => {
    const { client, calls } = recordingClient(await mrBackend());
    renderApp({ screen: 'S-05', sessionId: MR_SESSION }, client);
    await within(await panel()).findAllByRole('listitem');
    expect(listRows()).toHaveLength(5);
    expect(within(rowAt(1)).getByText(MOCK_DRAFTS[0]?.body ?? '')).toBeInTheDocument();

    await userEvent.click(boxOf(1));
    await waitFor(() => {
      expect(boxOf(1)).not.toBeChecked();
    });
    await userEvent.click(pencilOf(2));
    await userEvent.type(editorOf(2), ' Restored.');
    await userEvent.click(buttonIn(2, 'Save'));
    await waitFor(() => {
      expect(within(rowAt(2)).queryByRole('textbox')).toBeNull();
    });
    expect(within(rowAt(2)).getByText(/ Restored\.$/)).toBeInTheDocument();

    expect(calls).toContain('draftsUpdate');
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
  });
});
