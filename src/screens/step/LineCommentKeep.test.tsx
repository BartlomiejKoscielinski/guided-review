import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-09.7 fix round: a comment is never lost or hidden. A line card (a listed line draft or the
// open composer) inside one of Claude's folds opens that fold on its own (M4 decision 13: the
// reader finds the comment where they wrote it). The text being written lives with the step's
// state, so Ctrl+D (F-08.1, ADR-010) brings it back, and a composer holding unsaved text is not
// replaced: Comment, C or Undo elsewhere move the keyboard focus back to it instead.

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const ADDED = 'Added to drafts. It reaches GitLab only when you publish.';
const TEXT = 'Is the worker started before the first Kick?';
const HALF = 'Half a thought about the';

async function backend() {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const deleted: string[] = [];
  const client: IpcClient = {
    ...ipc,
    draftsDelete: (id) => {
      deleted.push(id);
      return ipc.draftsDelete(id);
    },
  };
  return { ipc, client, deleted };
}

function line(kind: 'add' | 'del' | 'ctx', no: number): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-kind="${kind}"] [data-line-no="${String(no)}"]`,
  );
  if (!found) throw new Error(`${kind} line ${String(no)} is not in the diff`);
  return found;
}

async function openStep4(client: Partial<IpcClient>) {
  const app = renderApp({ screen: 'S-03', sessionId: SESSION }, client);
  await app.router.navigate(`/session/${SESSION}/step?step=s4`);
  expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
  await waitFor(() => {
    line('add', 47);
  });
  return app;
}

const composer = (name: string) => screen.findByRole('article', { name: `Comment on ${name}` });
const textArea = (card: HTMLElement) => within(card).getByRole('textbox', { name: 'Comment' });
const selectedBar = () => screen.getByRole('group', { name: 'Selected lines' });
const follows = (before: Node, after: Node) =>
  (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const ctrlD = () => userEvent.keyboard('{Control>}d{/Control}');

/** Selects line `from` (to `to`) and presses Comment in the "Selected lines" group. */
async function pressComment(from: number, to = from) {
  await userEvent.click(line('add', from));
  if (to !== from) {
    await userEvent.keyboard('{Shift>}');
    await userEvent.click(line('add', to));
    await userEvent.keyboard('{/Shift}');
  }
  await userEvent.click(within(selectedBar()).getByRole('button', { name: 'Comment' }));
}

/** Comments on line `from` (to `to`): the composer under the last line. */
async function commentOn(from: number, to = from) {
  await pressComment(from, to);
  return composer(`L${String(to)}`);
}

describe('S-03 line comments are never lost or hidden (F-09.7)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // A measured diff row (`data-index`) is one line high and the column is tall, so all of step
    // 4's lines render in jsdom.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-09.7 a line draft inside Claude’s fold shows under its line when the step opens: the fold opens on its own (L14)', async () => {
    const { ipc, client } = await backend();
    await ipc.draftsCreate({
      sessionId: SESSION,
      findingId: null,
      body: TEXT,
      position: { file: VM, side: 'new', line: 14 },
      severity: null,
    });
    await openStep4(client);

    const card = await composer('L14');
    expect(within(card).getByText(TEXT)).toBeInTheDocument();
    expect(within(card).getByText(ADDED)).toBeInTheDocument();
    expect(follows(line('add', 14), card)).toBe(true);
    expect(follows(card, line('add', 15))).toBe(true);
  });

  it('F-09.7 the text being written comes back after Ctrl+D to Detailed and back', async () => {
    const { client } = await backend();
    await openStep4(client);
    const card = await commentOn(47, 50);
    await userEvent.type(textArea(card), HALF);

    await ctrlD();
    await screen.findByRole('complementary', { name: 'Guide' });
    const detailed = await composer('L50');
    expect(textArea(detailed)).toHaveValue(HALF);
    expect(textArea(detailed)).toHaveFocus();

    await userEvent.type(textArea(detailed), ' queue');
    await ctrlD();
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
    expect(textArea(await composer('L50'))).toHaveValue(`${HALF} queue`);
  });

  it('F-09.7 Comment or C on other lines while the composer holds text keeps it and moves the focus back to its text', async () => {
    const { client } = await backend();
    await openStep4(client);
    const card = await commentOn(47, 50);
    await userEvent.type(textArea(card), HALF);

    await pressComment(46);
    expect(screen.queryByRole('article', { name: 'Comment on L46' })).toBeNull();
    const kept = await composer('L50');
    expect(textArea(kept)).toHaveValue(HALF);
    expect(textArea(kept)).toHaveFocus();

    await userEvent.click(line('add', 46));
    await userEvent.keyboard('c');
    expect(screen.queryByRole('article', { name: 'Comment on L46' })).toBeNull();
    expect(textArea(await composer('L50'))).toHaveFocus();
  });

  it('F-09.7 an empty composer still moves to the lines commented on next', async () => {
    const { client } = await backend();
    await openStep4(client);
    await commentOn(47, 50);
    expect(await commentOn(46)).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Comment on L50' })).toBeNull();
  });

  it('F-09.7 Undo on another comment while the composer holds text keeps that draft and moves the focus back to the text', async () => {
    const { ipc, client, deleted } = await backend();
    await ipc.draftsCreate({
      sessionId: SESSION,
      findingId: null,
      body: TEXT,
      position: { file: VM, side: 'new', line: 50 },
      severity: null,
    });
    await openStep4(client);
    const card = await commentOn(47);
    await userEvent.type(textArea(card), HALF);

    const listed = await composer('L50');
    await userEvent.click(within(listed).getByRole('button', { name: 'Undo' }));
    expect(deleted).toEqual([]);
    expect(within(await composer('L50')).getByText(ADDED)).toBeInTheDocument();
    const kept = await composer('L47');
    expect(textArea(kept)).toHaveValue(HALF);
    expect(textArea(kept)).toHaveFocus();
  });
});
