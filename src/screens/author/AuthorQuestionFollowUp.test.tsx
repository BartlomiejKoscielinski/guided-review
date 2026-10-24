import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import { renderApp } from '../../test/renderApp';

// F-26.7: "Answered…" follows the thread, not the last click. After Send reply the card reads
// "Answered. The thread stays open until Piotr resolves it."; when the reviewer then adds a note
// (the next authorMr load lists it after my reply and tags the thread Question again), the card
// offers the reply area again, empty, and the heading counts the thread as one to answer.
// Against the mock backend's !480 (Piotr S. UploadWorker.cs:36 is the question).

const IID = 480;
const QUESTION_ID = 'author-t2';
const PIOTR = 'What happens if the app is killed in the middle of retrying?';
const SENT_LINE = 'Answered. The thread stays open until Piotr resolves it.';
const FOLLOW_UP = 'And after a reboot?';

type AuthorMr = Awaited<ReturnType<IpcClient['authorMr']>>;

/** The mock's !480; once `followUp()` is called the question lists a newer note from Piotr, after
 * my reply, as the core would load it. */
async function backend() {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  let followUp = false;
  const client: IpcClient = {
    ...base,
    authorMr: async (project, iid): Promise<AuthorMr> => {
      const mr = await base.authorMr(project, iid);
      if (!followUp) return mr;
      // The core counts a question whose last note is not mine as one to answer.
      return {
        ...mr,
        toAnswer: mr.toAnswer + 1,
        threads: mr.threads.map((t) => {
          const first = t.notes[0];
          if (t.id !== QUESTION_ID || !first) return t;
          const note = { ...first, body: FOLLOW_UP, createdAt: '2026-10-24T12:00:00Z' };
          return { ...t, status: 'question' as const, notes: [...t.notes, note] };
        }),
      };
    },
  };
  return {
    client,
    followUp: () => {
      followUp = true;
    },
  };
}

const card = () => screen.findByRole('region', { name: 'Thread' });
const option = (name: RegExp) => {
  const found = within(screen.getByRole('listbox', { name: 'Threads' }))
    .getAllByRole('option')
    .find((o) => name.test(o.textContent));
  if (!found) throw new Error(`no thread option ${String(name)}`);
  return found;
};
const heading = () => screen.getByRole('heading', { level: 1 });

describe('S-10 question thread: a follow-up after the reply (F-26.7)', () => {
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

  it('F-26.7 a reviewer note after my reply brings the reply area back and the thread counts as to answer again', async () => {
    const { client, followUp } = await backend();
    const app = renderApp({ screen: 'S-01' }, client);
    await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));
    await card();
    await userEvent.click(option(/Piotr S\./));
    const thread = within(await card());
    await thread.findByText(new RegExp(PIOTR));

    await userEvent.type(thread.getByRole('textbox', { name: 'Your reply' }), 'In memory only.');
    await userEvent.click(thread.getByRole('button', { name: 'Send reply' }));
    expect(await thread.findByText(SENT_LINE)).toBeInTheDocument();
    expect(heading()).toHaveTextContent('1 thread to answer');

    // Piotr answers; the screen loads the MR again (here: leaving S-10 and coming back).
    followUp();
    await act(() => app.router.navigate(pathFor({ screen: 'S-01' })));
    await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));
    await card();
    await userEvent.click(option(/Piotr S\./));
    const again = within(await card());
    expect(await again.findByText(FOLLOW_UP)).toBeInTheDocument();

    expect(again.getByRole('textbox', { name: 'Your reply' })).toHaveValue('');
    expect(again.getByRole('button', { name: 'Send reply' })).toBeDisabled();
    expect(again.getByRole('button', { name: 'Draft with Claude' })).toBeEnabled();
    expect(again.queryByText(SENT_LINE)).toBeNull();
    await waitFor(() => {
      expect(within(option(/Piotr S\./)).getByText('Question')).toBeInTheDocument();
    });
    expect(heading()).toHaveTextContent('2 threads to answer');
  });
});
