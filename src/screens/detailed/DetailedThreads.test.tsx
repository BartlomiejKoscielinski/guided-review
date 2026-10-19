import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { Thread } from '../../ipc/types/Thread';
import { useDetailedStore } from '../../state/detailed';
import { renderApp } from '../../test/renderApp';

// F-11.1 on S-04 (M5 decision 3): the threads on lines of the current step show under their
// lines in Detailed mode as they do in Focus, with the gutter thread icon on the line: initials
// squares, "author · age", the text and the replies. The Guide aside does not list them. A
// self-review has none (F-17.2).

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const QUEUE = 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs';
const KICK = 'Kick() is called on the UI thread. Does the worker block anything here?';
const SEMAPHORE = 'Kick only releases a semaphore, the upload runs in the background.';
// A day and a few hours after Paweł S.'s note on line 48 (2026-10-12 09:31 UTC) and 3 h after
// Marta K.'s reply: Review.dc.html's "yesterday" and "3 h ago".
const NOW = new Date('2026-10-13T09:40:00.000Z');

/** A mock backend of its own, with the session's plan prepared as S-02 does. */
async function backend(kind: 'mr' | 'commit' = 'mr') {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const sessionId =
    kind === 'mr' ? SESSION : (await ipc.sessionOpenCommit({ to: 'a3f9c12' })).sessionId;
  await ipc.reviewPlan(sessionId, () => undefined);
  return { ipc, sessionId };
}

/** S-04 on a step of the session (!482's step 4 holds the thread at `_worker.Kick()`, line 48). */
async function openDetailed(client: Partial<IpcClient>, sessionId = SESSION, step = 's4') {
  const app = renderApp({ screen: 'S-04', sessionId }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId })}?step=${step}`);
  await screen.findByRole('heading', { level: 1 });
  return app;
}

const THREAD_48 = 'Thread at line 48';
const icon = (line: number) =>
  screen.findByRole('button', { name: `Thread by Paweł S. at line ${String(line)}` });
const fileOf = (path: string) => screen.getByRole('region', { name: path });
/** The virtual rows of a file's diff, in order (`data-index`; a card sits in a row of its own). */
const rowsOf = (file: HTMLElement) => Array.from(file.querySelectorAll('[data-index]'));

describe('S-04 threads (F-11.1)', () => {
  beforeEach(() => {
    useDetailedStore.setState({ layout: 'split' });
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows. A measured
    // diff row (`data-index`) is one line high and the column is tall, so all of step 4's lines
    // render.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('F-11.1 a thread on a line of the step shows under that line with avatars, author · age, text and the reply', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { ipc } = await backend();
    await openDetailed(ipc);

    const card = await screen.findByRole('region', { name: THREAD_48 });
    const file = fileOf(VM);
    expect(file).toContainElement(card);
    // The first note and, after it, Marta K.'s reply.
    expect(within(card).getByText(KICK)).toBeInTheDocument();
    expect(within(card).getByText(SEMAPHORE)).toBeInTheDocument();
    expect(card.textContent.indexOf(SEMAPHORE)).toBeGreaterThan(card.textContent.indexOf(KICK));
    // Author · age on each note.
    expect(within(card).getByText('Paweł S.', { selector: 'b' }).parentElement).toHaveTextContent(
      /^Paweł S\. · yesterday$/,
    );
    expect(within(card).getByText('Marta K.', { selector: 'b' }).parentElement).toHaveTextContent(
      /^Marta K\. · 3 h ago$/,
    );
    // An avatar square with the initials of each author.
    expect(within(card).getByText('PS')).toBeInTheDocument();
    expect(within(card).getByText('MK')).toBeInTheDocument();

    // Right under the row of line 48 (`_worker.Kick();`), before the row of line 49.
    const rows = rowsOf(file);
    const at = rows.findIndex((row) => row.contains(card));
    expect(at).toBeGreaterThan(0);
    expect(rows[at - 1]?.querySelector('[data-kind="add"] [data-line-no="48"]')).not.toBeNull();
    expect(rows[at + 1]?.querySelector('[data-kind="add"] [data-line-no="49"]')).not.toBeNull();
  });

  it('F-11.1 the thread icon sits on the thread’s line and closes and opens the card', async () => {
    const { ipc } = await backend();
    await openDetailed(ipc);

    const mark = await icon(48);
    expect(mark).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: THREAD_48 })).toBeInTheDocument();
    // On the row of line 48 itself, as the notes’ squares are on theirs.
    const row = mark.closest('[data-index]');
    expect(row?.querySelector('[data-kind="add"] [data-line-no="48"]')).not.toBeNull();

    await userEvent.click(mark);
    expect(mark).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: THREAD_48 })).toBeNull();
    // The icon stays, so the thread can be opened again.
    await userEvent.click(mark);
    expect(mark).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('region', { name: THREAD_48 })).toHaveTextContent(SEMAPHORE);
  });

  it('F-11.1 the thread shows under its line in the unified layout too', async () => {
    useDetailedStore.setState({ layout: 'unified' });
    const { ipc } = await backend();
    await openDetailed(ipc);

    const card = await screen.findByRole('region', { name: THREAD_48 });
    const rows = rowsOf(fileOf(VM));
    const at = rows.findIndex((row) => row.contains(card));
    expect(at).toBeGreaterThan(0);
    expect(rows[at - 1]?.querySelector('[data-kind="add"] [data-line-no="48"]')).not.toBeNull();
    expect(await icon(48)).toHaveAttribute('aria-expanded', 'true');
  });

  it('F-11.1 the step shows only the threads on its own lines: step 2 has its two, not step 4’s', async () => {
    const { ipc } = await backend();
    await openDetailed(ipc, SESSION, 's2');

    expect(await icon(24)).toHaveAttribute('aria-expanded', 'true');
    const first = screen.getByRole('region', { name: 'Thread at line 24' });
    // Plain text, as written: the backticks of the comment stay (no Markdown library, 06 T10).
    expect(first).toHaveTextContent(
      'Is the table created on every start? `CREATE TABLE IF NOT EXISTS` would be enough here.',
    );
    expect(first).toHaveTextContent(
      'It runs once per connection; I can move it to the migration step.',
    );
    expect(within(first).getByText('PS')).toBeInTheDocument();
    expect(within(first).getByText('AK')).toBeInTheDocument();
    expect(within(first).getByText('Anna K.', { selector: 'b' })).toBeInTheDocument();
    // The second thread of the step is further down the same file.
    expect(await icon(61)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Thread at line 61' })).toHaveTextContent(
      'What happens to a photo that keeps failing? I don’t see a limit on attempts.',
    );
    expect(fileOf(QUEUE)).toContainElement(first);
    // Step 4's thread is not here.
    expect(screen.queryByRole('region', { name: THREAD_48 })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thread by Paweł S. at line 48' })).toBeNull();
  });

  it('F-11.1 a step with no thread on its lines shows no thread icon or card', async () => {
    const { ipc } = await backend();
    await openDetailed(ipc, SESSION, 's1');

    expect(await screen.findByRole('navigation', { name: 'Review plan' })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector('[data-line-no]')).not.toBeNull();
    });
    expect(screen.queryAllByRole('region', { name: /^Thread at line/ })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Thread by / })).toBeNull();
  });

  it('F-11.1 the Guide aside does not list the threads (M5 decision 3)', async () => {
    const { ipc } = await backend();
    await openDetailed(ipc);

    // The card is in the diff; the aside has Code notes, For you to judge and the Ask box only.
    await screen.findByRole('region', { name: THREAD_48 });
    const aside = screen.getByRole('complementary', { name: 'Guide' });
    expect(within(aside).queryByText(/Kick\(\) is called on the UI thread/)).toBeNull();
    expect(within(aside).queryByRole('region', { name: /^Thread at line/ })).toBeNull();
    expect(within(aside).queryByRole('button', { name: /^Thread by / })).toBeNull();
  });

  it('F-11.1 a thread on a removed line shows under that line (old side)', async () => {
    const { ipc, sessionId } = await backend();
    // The mock's thread, moved to the removed `await _api.UploadPhotoAsync(...)` (old line 37).
    const reviewStep: IpcClient['reviewStep'] = async (id, stepId) => {
      const view = await ipc.reviewStep(id, stepId);
      return {
        ...view,
        threads: view.threads.map((thread): Thread => ({
          ...thread,
          position: {
            oldPath: VM,
            newPath: VM,
            oldLine: 37,
            headSha: '9c41e07',
            baseSha: '5e2a9c4',
          },
        })),
      };
    };
    await openDetailed({ ...ipc, reviewStep }, sessionId);

    const card = await screen.findByRole('region', { name: 'Thread at line 37' });
    expect(await icon(37)).toHaveAttribute('aria-expanded', 'true');
    const rows = rowsOf(fileOf(VM));
    const at = rows.findIndex((row) => row.contains(card));
    expect(at).toBeGreaterThan(0);
    expect(rows[at - 1]?.querySelector('[data-kind="del"] [data-line-no="37"]')).not.toBeNull();
  });

  it('F-11.1 a comment’s HTML is shown as text, never as markup (06 T10)', async () => {
    const { ipc, sessionId } = await backend();
    const reviewStep: IpcClient['reviewStep'] = async (id, stepId) => {
      const view = await ipc.reviewStep(id, stepId);
      return {
        ...view,
        threads: view.threads.map((thread) => ({
          ...thread,
          notes: thread.notes.map((note, i) =>
            i === 0
              ? {
                  ...note,
                  body: 'Look: <img src="x" onerror="alert(1)"> and <script>alert(1)</script> then <b>bold</b> end',
                }
              : note,
          ),
        })),
      };
    };
    await openDetailed({ ...ipc, reviewStep }, sessionId);

    const card = await screen.findByRole('region', { name: THREAD_48 });
    expect(card).toHaveTextContent('Look:');
    expect(card).toHaveTextContent('end');
    expect(card.querySelector('img, script, [onerror]')).toBeNull();
    // Only the two bylines have a <b>.
    expect(card.querySelectorAll('b')).toHaveLength(2);
  });

  it('F-11.1 a self-review (a session of commits) has no thread icon or card in S-04 (F-17.2)', async () => {
    const { ipc, sessionId } = await backend('commit');
    await openDetailed(ipc, sessionId);

    // Step 4 of the commit session holds the same file; the diff is drawn, with no thread on it.
    const file = await screen.findByRole('region', { name: VM });
    await waitFor(() => {
      expect(file.querySelector('[data-kind="add"] [data-line-no="48"]')).not.toBeNull();
    });
    expect(screen.queryAllByRole('region', { name: /^Thread at line/ })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Thread by / })).toBeNull();
  });
});
