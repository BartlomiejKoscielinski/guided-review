import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { NewDraft } from '../../ipc/types/NewDraft';
import { useFocusStore, type FocusLayout } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-09.7 in S-03 (M4 plan, decision 13): C, or Comment in the "Selected lines" group, opens an
// inline composer under the line in the note-card style: a neutral "Comment" tag with the line
// ("L50"; old side "old L38"), a text area "Write a comment…", Add to drafts (Ctrl+Enter,
// disabled while empty) and Cancel (Esc). With several lines selected it opens under the last one
// and the draft is anchored there. Add to drafts creates a draft with the line's position and no
// note; the card keeps the text with the F-09.3 confirmation and Undo (deletes the draft). Line
// drafts show this way under their lines when the step is opened again. Self-review: Keep to fix.
// Locators the implementation keeps: the card is an article named "Comment on L50" (old side
// "Comment on old L38"), its text area is the textbox "Comment", the group's button is "Comment".

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const ADDED = 'Added to drafts. It reaches GitLab only when you publish.';
const KEPT = "Kept to fix. It's on your list at the end.";
const TEXT = 'Is the worker started before the first Kick?';

/** A mock backend of its own that records the drafts the screen creates and deletes. */
async function backend(kind: 'mr' | 'local' = 'mr') {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const sessionId =
    kind === 'mr' ? SESSION : (await ipc.sessionOpenLocal({ kind: 'staged' })).sessionId;
  const created: NewDraft[] = [];
  const deleted: string[] = [];
  const client: IpcClient = {
    ...ipc,
    draftsCreate: (draft) => {
      created.push(draft);
      return ipc.draftsCreate(draft);
    },
    draftsDelete: (id) => {
      deleted.push(id);
      return ipc.draftsDelete(id);
    },
  };
  return { ipc, client, sessionId, created, deleted };
}

/** The number cell of a diff line: split rows show a context line on both sides. */
function line(kind: 'add' | 'del' | 'ctx', no: number): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-kind="${kind}"] [data-line-no="${String(no)}"]`,
  );
  if (!found) throw new Error(`${kind} line ${String(no)} is not in the diff`);
  return found;
}

async function shiftClick(element: HTMLElement) {
  await userEvent.keyboard('{Shift>}');
  await userEvent.click(element);
  await userEvent.keyboard('{/Shift}');
}

/** Step 4 (!482's ViewModel) with its diff drawn, in the given layout. */
async function openStep4(
  client: Partial<IpcClient>,
  sessionId = SESSION,
  layout: FocusLayout = 'A',
) {
  const app = renderApp({ screen: 'S-03', sessionId }, client);
  await app.router.navigate(`/session/${sessionId}/step?step=s4`);
  expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
  if (layout !== 'A') {
    act(() => {
      useFocusStore.getState().setLayout(layout);
    });
  }
  await waitFor(() => {
    line('add', 47);
  });
  return app;
}

const selectedBar = () => screen.getByRole('group', { name: 'Selected lines' });
const composer = (name: string) => screen.findByRole('article', { name: `Comment on ${name}` });
const noComposer = () => {
  expect(screen.queryByRole('article', { name: /^Comment on / })).toBeNull();
};
const textArea = (card: HTMLElement) => within(card).getByRole('textbox', { name: 'Comment' });

/** `after` comes later in the document than `before`. */
const follows = (before: Node, after: Node) =>
  (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

/** Selects lines 47–50 of the ViewModel and presses Comment in the "Selected lines" group. */
async function commentOn47to50() {
  await userEvent.click(line('add', 47));
  await shiftClick(line('add', 50));
  await userEvent.click(within(selectedBar()).getByRole('button', { name: 'Comment' }));
  return composer('L50');
}

describe('S-03 line comment composer (F-09.7)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-09.7 Comment on the selected lines opens the composer under the last line: Comment tag, L50, focused text area, Add to drafts and Cancel', async () => {
    const { client } = await backend();
    await openStep4(client);
    noComposer();

    const card = await commentOn47to50();
    expect(within(card).getByText('Comment')).toBeInTheDocument();
    expect(within(card).getByText('L50')).toBeInTheDocument();
    const text = textArea(card);
    expect(text.tagName).toBe('TEXTAREA');
    expect(text).toHaveAttribute('placeholder', 'Write a comment…');
    expect(text).toHaveFocus();
    expect(within(card).getByRole('button', { name: 'Add to drafts' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    // Under the last selected line, above the next one.
    expect(follows(line('add', 50), card)).toBe(true);
    expect(follows(card, line('add', 51))).toBe(true);
  });

  it('F-09.7 Add to drafts stays disabled while the text area is empty or only spaces', async () => {
    const { client, created } = await backend();
    await openStep4(client);
    const card = await commentOn47to50();
    const add = within(card).getByRole('button', { name: 'Add to drafts' });
    expect(add).toBeDisabled();
    await userEvent.type(textArea(card), '   ');
    expect(add).toBeDisabled();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(created).toEqual([]);
    await userEvent.type(textArea(card), 'Why?');
    expect(add).toBeEnabled();
  });

  it('F-09.7 Add to drafts creates a draft on the line with no note; the card keeps the text with the confirmation and Undo', async () => {
    const { ipc, client, created } = await backend();
    await openStep4(client);
    const card = await commentOn47to50();
    await userEvent.type(textArea(card), TEXT);
    await userEvent.click(within(card).getByRole('button', { name: 'Add to drafts' }));

    expect(await within(card).findByText(ADDED)).toBeInTheDocument();
    expect(created).toEqual([
      {
        sessionId: SESSION,
        findingId: null,
        body: TEXT,
        position: { file: VM, side: 'new', line: 50 },
        severity: null,
      },
    ]);
    expect(within(card).getByText(TEXT)).toBeInTheDocument();
    expect(within(card).queryByRole('textbox')).toBeNull();
    // As after a note's decision (F-09.3), the keyboard focus moves to Undo.
    expect(within(card).getByRole('button', { name: 'Undo' })).toHaveFocus();
    const drafts = await ipc.draftsList(SESSION);
    expect(drafts.map((d) => [d.body, d.findingId, d.stepId])).toEqual([[TEXT, null, 's4']]);
  });

  it('F-09.7 Ctrl+Enter in the text area adds the draft', async () => {
    const { client, created } = await backend();
    await openStep4(client);
    const card = await commentOn47to50();
    await userEvent.type(textArea(card), TEXT);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(await within(card).findByText(ADDED)).toBeInTheDocument();
    expect(created.map((d) => d.position)).toEqual([{ file: VM, side: 'new', line: 50 }]);
  });

  it('F-09.7 Cancel and Esc discard the composer without a draft; Esc closes only the composer and keeps the selection', async () => {
    const { ipc, client, created } = await backend();
    await openStep4(client);
    let card = await commentOn47to50();
    await userEvent.type(textArea(card), 'Not this one.');
    await userEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    noComposer();

    card = await composerAgain();
    // The text of a discarded comment is gone.
    expect(textArea(card)).toHaveValue('');
    await userEvent.type(textArea(card), 'Nor this one.');
    await userEvent.keyboard('{Escape}');
    noComposer();
    expect(within(selectedBar()).getByText('Lines 47–50')).toBeInTheDocument();

    expect(created).toEqual([]);
    expect(await ipc.draftsList(SESSION)).toEqual([]);
  });

  it('F-09.7 Undo deletes the draft and brings its text back into the composer', async () => {
    const { ipc, client, deleted } = await backend();
    await openStep4(client);
    const card = await commentOn47to50();
    await userEvent.type(textArea(card), TEXT);
    await userEvent.click(within(card).getByRole('button', { name: 'Add to drafts' }));
    await within(card).findByText(ADDED);
    const [draft] = await ipc.draftsList(SESSION);

    await userEvent.click(within(card).getByRole('button', { name: 'Undo' }));
    const back = await composer('L50');
    await waitFor(() => {
      expect(textArea(back)).toHaveValue(TEXT);
    });
    expect(textArea(back)).toHaveFocus();
    expect(within(back).queryByText(ADDED)).toBeNull();
    expect(deleted).toEqual([draft?.id]);
    expect(await ipc.draftsList(SESSION)).toEqual([]);
  });

  it('F-09.7 C opens the composer under the selected line; a deleted line is anchored on the old side', async () => {
    const { client, created } = await backend();
    await openStep4(client);
    await userEvent.click(line('del', 38));
    await userEvent.keyboard('c');

    const card = await composer('old L38');
    expect(within(card).getByText('old L38')).toBeInTheDocument();
    expect(textArea(card)).toHaveFocus();
    expect(follows(line('del', 38), card)).toBe(true);
    await userEvent.type(textArea(card), 'Why is the dialog gone?');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await within(card).findByText(ADDED);
    expect(created.map((d) => d.position)).toEqual([{ file: VM, side: 'old', line: 38 }]);
  });

  it('F-09.7 C without a selection opens the composer under the step’s first changed line outside Claude’s fold (L46)', async () => {
    const { client, created } = await backend();
    await openStep4(client);
    // Lines 12–31 ("Fields and constructor") are folded by Claude; the first changed line shown
    // is the new line 46, paired with the deleted line 37.
    await userEvent.keyboard('c');

    const card = await composer('L46');
    expect(within(card).getByText('L46')).toBeInTheDocument();
    expect(follows(line('add', 46), card)).toBe(true);
    expect(follows(card, line('add', 47))).toBe(true);
    await userEvent.type(textArea(card), TEXT);
    await userEvent.click(within(card).getByRole('button', { name: 'Add to drafts' }));
    await within(card).findByText(ADDED);
    expect(created.map((d) => d.position)).toEqual([{ file: VM, side: 'new', line: 46 }]);
  });

  it('F-09.7 C does nothing with Ctrl held or while typing in a text field', async () => {
    const { client } = await backend();
    await openStep4(client);
    await userEvent.click(line('add', 47));
    await userEvent.keyboard('{Control>}c{/Control}');
    noComposer();

    await userEvent.click(within(selectedBar()).getByRole('button', { name: 'Comment' }));
    const card = await composer('L47');
    await userEvent.type(textArea(card), 'check');
    expect(textArea(card)).toHaveValue('check');
    expect(screen.getAllByRole('article', { name: /^Comment on / })).toHaveLength(1);
  });

  it('F-09.7 line drafts of the step show under their lines when the step is opened again; a note’s draft and an MR comment do not', async () => {
    const { ipc, client } = await backend();
    await ipc.draftsCreate({
      sessionId: SESSION,
      findingId: null,
      body: TEXT,
      position: { file: VM, side: 'new', line: 50 },
      severity: null,
    });
    await ipc.draftsCreate({
      sessionId: SESSION,
      findingId: 'f1',
      body: 'Drafted from a note.',
      position: { file: VM, side: 'new', line: 47 },
      severity: 'q',
    });
    await ipc.draftsCreate({
      sessionId: SESSION,
      findingId: null,
      body: 'On the whole merge request.',
      position: null,
      severity: null,
    });
    await openStep4(client);

    const card = await composer('L50');
    expect(within(card).getByText(TEXT)).toBeInTheDocument();
    expect(within(card).getByText(ADDED)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(follows(line('add', 50), card)).toBe(true);
    expect(follows(card, line('add', 51))).toBe(true);
    expect(screen.getAllByRole('article', { name: /^Comment on / })).toHaveLength(1);
    expect(screen.queryByText('Drafted from a note.')).toBeNull();
    expect(screen.queryByText('On the whole merge request.')).toBeNull();
  });

  it('F-09.7 in layouts B and C the composer opens under the line in the diff', async () => {
    for (const layout of ['B', 'C'] as const) {
      const { client } = await backend();
      const app = await openStep4(client, SESSION, layout);
      await userEvent.click(line('add', 48));
      await userEvent.click(within(selectedBar()).getByRole('button', { name: 'Comment' }));
      const card = await composer('L48');
      expect(follows(line('add', 48), card)).toBe(true);
      expect(follows(card, line('add', 49))).toBe(true);
      if (layout === 'C') {
        expect(
          within(screen.getByRole('complementary', { name: 'Guide' })).queryByRole('article', {
            name: /^Comment on /,
          }),
        ).toBeNull();
      }
      app.unmount();
      useFocusStore.setState({ layout: 'A' });
    }
  });

  it('F-09.7 in a self-review the composer keeps to fix: Keep to fix, then "Kept to fix. It’s on your list at the end."', async () => {
    const { client, sessionId, created } = await backend('local');
    await openStep4(client, sessionId);
    await userEvent.click(line('add', 47));
    await userEvent.click(within(selectedBar()).getByRole('button', { name: 'Comment' }));
    const card = await composer('L47');
    expect(within(card).queryByRole('button', { name: 'Add to drafts' })).toBeNull();
    await userEvent.type(textArea(card), TEXT);
    await userEvent.click(within(card).getByRole('button', { name: 'Keep to fix' }));

    expect(await within(card).findByText(KEPT)).toBeInTheDocument();
    expect(within(card).queryByText(ADDED)).toBeNull();
    expect(created.map((d) => [d.sessionId, d.findingId, d.position])).toEqual([
      [sessionId, null, { file: VM, side: 'new', line: 47 }],
    ]);
  });

  it('F-09.7 while the session is still looked up the composer keeps the merge request copy, as the note cards do', async () => {
    const { client } = await backend();
    await openStep4({ ...client, sessionMr: () => new Promise(() => undefined) });
    await userEvent.click(line('add', 47));
    await userEvent.click(within(selectedBar()).getByRole('button', { name: 'Comment' }));
    const card = await composer('L47');
    expect(within(card).getByRole('button', { name: 'Add to drafts' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Keep to fix' })).toBeNull();
  });
});

/** Opens the composer again from the selection that is still there. */
async function composerAgain() {
  await userEvent.click(within(selectedBar()).getByRole('button', { name: 'Comment' }));
  return composer('L50');
}
