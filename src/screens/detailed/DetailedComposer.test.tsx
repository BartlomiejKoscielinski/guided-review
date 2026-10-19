import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { NewDraft } from '../../ipc/types/NewDraft';
import { renderApp } from '../../test/renderApp';

// F-09.7 in S-04 (docs/02 › S-04: the composer opens under the line in the note-card style, in
// both modes; M4 decisions 12 and 13). Detailed draws no line selection, so C opens the composer:
// under the selected line when S-03 left one, else under the step's first changed line (S-04 has
// no Claude folds, so step 4's first changed line is the new line 14). The card is an article
// named "Comment on L14" with the text area "Comment"; a self-review says Keep to fix.

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const ADDED = 'Added to drafts. It reaches GitLab only when you publish.';
const KEPT = "Kept to fix. It's on your list at the end.";
const TEXT = 'Does the queue need to be a singleton?';

/** A mock backend of its own, with the session's plan prepared as S-02 does. */
async function backend(kind: 'mr' | 'commit' = 'mr') {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const sessionId =
    kind === 'mr' ? SESSION : (await ipc.sessionOpenCommit({ to: 'a3f9c12' })).sessionId;
  await ipc.reviewPlan(sessionId, () => undefined);
  const created: NewDraft[] = [];
  const client: IpcClient = {
    ...ipc,
    draftsCreate: (draft) => {
      created.push(draft);
      return ipc.draftsCreate(draft);
    },
  };
  return { ipc, client, sessionId, created };
}

function line(kind: 'add' | 'del' | 'ctx', no: number): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-kind="${kind}"] [data-line-no="${String(no)}"]`,
  );
  if (!found) throw new Error(`${kind} line ${String(no)} is not in the diff`);
  return found;
}

/** S-04 on step 4 (!482's ViewModel) with its diff drawn. */
async function openDetailed(client: Partial<IpcClient>, sessionId = SESSION) {
  const app = renderApp({ screen: 'S-04', sessionId }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId })}?step=s4`);
  await screen.findByRole('heading', { level: 1 });
  await waitFor(() => {
    line('add', 14);
  });
  return app;
}

const composer = (name: string) => screen.findByRole('article', { name: `Comment on ${name}` });
const textArea = (card: HTMLElement) => within(card).getByRole('textbox', { name: 'Comment' });
const follows = (before: Node, after: Node) =>
  (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

// Typing re-renders the step's diff on each key (about 1.3 s alone); `npm run verify` runs the
// suite beside cargo test, which made it four times slower and past the 5 s default.
describe('S-04 line comment composer (F-09.7)', { timeout: 15_000 }, () => {
  beforeEach(() => {
    // A measured diff row (`data-index`) is one line high and the column is tall, so all of step
    // 4's lines render in jsdom.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-09.7 in Detailed mode C opens the composer under the step’s first changed line (L14); Add to drafts creates the draft there', async () => {
    const { client, created } = await backend();
    await openDetailed(client);
    expect(screen.queryByRole('article', { name: /^Comment on / })).toBeNull();
    await userEvent.keyboard('c');

    const card = await composer('L14');
    expect(within(card).getByText('Comment')).toBeInTheDocument();
    expect(within(card).getByText('L14')).toBeInTheDocument();
    expect(textArea(card)).toHaveFocus();
    expect(textArea(card)).toHaveAttribute('placeholder', 'Write a comment…');
    expect(within(card).getByRole('button', { name: 'Add to drafts' })).toBeDisabled();
    expect(follows(line('add', 14), card)).toBe(true);
    expect(follows(card, line('add', 15))).toBe(true);

    await userEvent.type(textArea(card), TEXT);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(await within(card).findByText(ADDED)).toBeInTheDocument();
    expect(within(card).getByText(TEXT)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(created).toEqual([
      {
        sessionId: SESSION,
        findingId: null,
        body: TEXT,
        position: { file: VM, side: 'new', line: 14 },
        severity: null,
      },
    ]);
  });

  it('F-09.7 in Detailed mode Esc discards the composer without a draft', async () => {
    const { ipc, client, created } = await backend();
    await openDetailed(client);
    await userEvent.keyboard('c');
    const card = await composer('L14');
    await userEvent.type(textArea(card), 'Not this one.');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('article', { name: /^Comment on / })).toBeNull();
    expect(created).toEqual([]);
    expect(await ipc.draftsList(SESSION)).toEqual([]);
  });

  it('F-09.7 a line draft of the step shows under its line in Detailed mode with the confirmation and Undo', async () => {
    const { ipc, client } = await backend();
    await ipc.draftsCreate({
      sessionId: SESSION,
      findingId: null,
      body: TEXT,
      position: { file: VM, side: 'new', line: 50 },
      severity: null,
    });
    await openDetailed(client);

    const card = await composer('L50');
    expect(within(card).getByText(TEXT)).toBeInTheDocument();
    expect(within(card).getByText(ADDED)).toBeInTheDocument();
    expect(follows(line('add', 50), card)).toBe(true);
    expect(follows(card, line('add', 51))).toBe(true);

    await userEvent.click(within(card).getByRole('button', { name: 'Undo' }));
    await waitFor(async () => {
      expect(await ipc.draftsList(SESSION)).toEqual([]);
    });
  });

  it('F-09.7 in a self-review in Detailed mode the composer says Keep to fix, then "Kept to fix. It’s on your list at the end."', async () => {
    const { client, sessionId, created } = await backend('commit');
    await openDetailed(client, sessionId);
    await userEvent.keyboard('c');
    const card = await composer('L14');
    expect(within(card).queryByRole('button', { name: 'Add to drafts' })).toBeNull();
    await userEvent.type(textArea(card), TEXT);
    await userEvent.click(within(card).getByRole('button', { name: 'Keep to fix' }));
    expect(await within(card).findByText(KEPT)).toBeInTheDocument();
    expect(created.map((d) => [d.sessionId, d.findingId, d.position])).toEqual([
      [sessionId, null, { file: VM, side: 'new', line: 14 }],
    ]);
  });
});
