import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { StepView } from '../../ipc/types/StepView';
import type { Thread } from '../../ipc/types/Thread';
import { useDetailedStore } from '../../state/detailed';
import { renderApp } from '../../test/renderApp';

// F-11.3 on S-04 (M5 decision 3: the same cards as S-03): an outdated thread shows under its
// placed line with the word tag "Outdated"; a thread with no matching line, and a current thread
// outside the hunks, are cards on the file header, above the diff, the outdated one with the tag;
// the cards have the F-11.2 actions.

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const ANNA = { username: 'anna.k', name: 'Anna K.' };
const MARTA = { username: 'marta.k', name: 'Marta K.' };
const LINE_BODY = 'Should the pending count refresh here as well?';
const FILE_BODY = 'This block moved after my first look. Is the null check still needed?';
const CONTEXT_BODY = 'Do we need a using for the queue namespace?';

const ON_LINE: Thread = {
  id: 'o-line',
  resolvable: true,
  resolved: false,
  outdated: true,
  placedLine: 14,
  position: { oldPath: VM, newPath: VM, newLine: 9, headSha: '3b8d1f0', baseSha: '5e2a9c4' },
  notes: [{ id: 9101, author: ANNA, body: LINE_BODY, createdAt: '2026-10-12T08:00:00.000Z' }],
};
const ON_FILE: Thread = {
  id: 'o-file',
  resolvable: true,
  resolved: false,
  outdated: true,
  position: { oldPath: VM, newPath: VM, newLine: 60, headSha: '3b8d1f0', baseSha: '5e2a9c4' },
  notes: [{ id: 9102, author: MARTA, body: FILE_BODY, createdAt: '2026-10-12T08:10:00.000Z' }],
};
const ON_CONTEXT: Thread = {
  id: 'c-file',
  resolvable: true,
  resolved: false,
  outdated: false,
  position: { oldPath: VM, newPath: VM, newLine: 5, headSha: '9c41e07', baseSha: '5e2a9c4' },
  notes: [{ id: 9103, author: ANNA, body: CONTEXT_BODY, createdAt: '2026-10-12T08:20:00.000Z' }],
};

/** A mock backend of its own with the session's plan prepared, whose step views `patch` changes. */
async function backend(patch: (view: StepView) => StepView): Promise<IpcClient> {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  await ipc.reviewPlan(SESSION, () => undefined);
  return {
    ...ipc,
    reviewStep: async (sessionId, stepId) => patch(await ipc.reviewStep(sessionId, stepId)),
  };
}

/** S-04 on step 4 of the session. */
async function openDetailed(client: IpcClient) {
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=s4`);
  await screen.findByRole('heading', { level: 1 });
  return app;
}

const fileOf = () => screen.findByRole('region', { name: VM });
/** The virtual rows of a file's diff, in order (`data-index`; a card sits in a row of its own). */
const rowsOf = (file: HTMLElement) => Array.from(file.querySelectorAll('[data-index]'));

describe('S-04 threads on outdated lines (F-11.3)', () => {
  beforeEach(() => {
    useDetailedStore.setState({ layout: 'split' });
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows (as
    // DetailedThreads.test.tsx).
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-11.3 an outdated thread shows right under its placed line with the Outdated tag', async () => {
    await openDetailed(await backend((v) => ({ ...v, threads: [...v.threads, ON_LINE] })));
    const card = await screen.findByRole('region', { name: 'Thread at line 14' });
    expect(card).toHaveTextContent(LINE_BODY);
    expect(within(card).getByText('Outdated', { exact: true })).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Thread by Anna K. at line 14' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('region', { name: 'Thread at line 9' })).toBeNull();

    const rows = rowsOf(await fileOf());
    const at = rows.findIndex((row) => row.contains(card));
    expect(at).toBeGreaterThan(0);
    expect(rows[at - 1]?.querySelector('[data-kind="add"] [data-line-no="14"]')).not.toBeNull();
    expect(rows[at + 1]?.querySelector('[data-kind="add"] [data-line-no="15"]')).not.toBeNull();
    // The current thread of line 48 has no tag.
    const current = screen.getByRole('region', { name: 'Thread at line 48' });
    expect(within(current).queryByText('Outdated')).toBeNull();
  });

  it('F-11.3 an outdated thread without a match is a card on the file header, above the diff, with the Outdated tag', async () => {
    await openDetailed(await backend((v) => ({ ...v, fileThreads: [ON_FILE, ON_CONTEXT] })));
    const file = await fileOf();
    const cards = await within(file).findAllByRole('region', { name: `Thread on ${VM}` });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent(FILE_BODY);
    expect(cards[1]).toHaveTextContent(CONTEXT_BODY);
    // Outdated: tagged. Current but outside the hunks: not.
    expect(
      within(cards[0] as HTMLElement).getByText('Outdated', { exact: true }),
    ).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).queryByText('Outdated')).toBeNull();
    // After the file's path and before the first row of the diff.
    const path = within(file).getAllByTitle(VM)[0] as HTMLElement;
    const first = rowsOf(file)[0] as Element;
    expect(
      path.compareDocumentPosition(cards[0] as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (cards[1] as Node).compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Not on a line: no gutter icon for these.
    expect(screen.queryByRole('button', { name: /^Thread by Marta K\./ })).toBeNull();
  });

  it('F-11.3 a header card has the thread actions, and Resolve goes to GitLab with its discussion', async () => {
    const ipc = await backend((v) => ({ ...v, fileThreads: [ON_FILE] }));
    const resolveCall = vi.spyOn(ipc, 'gitlabResolve').mockResolvedValue(undefined);
    await openDetailed(ipc);
    const card = await screen.findByRole('region', { name: `Thread on ${VM}` });
    expect(
      within(card)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Resolve', 'Reply']);
    await userEvent.click(within(card).getByRole('button', { name: 'Resolve' }));
    expect(resolveCall).toHaveBeenCalledWith(SESSION, 'o-file', true);
  });
});
