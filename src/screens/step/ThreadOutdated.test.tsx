import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../app/queryClient';
import type { IpcClient } from '../../ipc/client';
import { IpcProvider } from '../../ipc/IpcProvider';
import { createMockClient } from '../../ipc/mock';
import type { StepView } from '../../ipc/types/StepView';
import type { Thread } from '../../ipc/types/Thread';
import { StepScreen } from './StepScreen';

// F-11.3 on S-03 (M5 decision 4): a thread written on an older version shows on the line the core
// placed it on, with the word tag "Outdated" (the "Resolved" tag's style, uppercase by CSS); a
// thread with no matching line shows on the file header, between the header and the diff, with
// the same tag when it is outdated; a current thread on a line outside the hunks is on the file
// header without it. The cards have the F-11.2 actions. The step view comes from the mock
// backend with the threads of these tests added.

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const ANNA = { username: 'anna.k', name: 'Anna K.' };
const MARTA = { username: 'marta.k', name: 'Marta K.' };
const LINE_BODY = 'Should the pending count refresh here as well?';
const FILE_BODY = 'This block moved after my first look. Is the null check still needed?';
const CONTEXT_BODY = 'Do we need a using for the queue namespace?';

/** Written on version 3b8d1f0 at line 9; the core placed it on line 14, in step 4's hunk. */
const ON_LINE: Thread = {
  id: 'o-line',
  resolvable: true,
  resolved: false,
  outdated: true,
  placedLine: 14,
  position: { oldPath: VM, newPath: VM, newLine: 9, headSha: '3b8d1f0', baseSha: '5e2a9c4' },
  notes: [{ id: 9101, author: ANNA, body: LINE_BODY, createdAt: '2026-10-12T08:00:00.000Z' }],
};
/** Outdated with no matching line: the file header. */
const ON_FILE: Thread = {
  id: 'o-file',
  resolvable: true,
  resolved: false,
  outdated: true,
  position: { oldPath: VM, newPath: VM, newLine: 60, headSha: '3b8d1f0', baseSha: '5e2a9c4' },
  notes: [{ id: 9102, author: MARTA, body: FILE_BODY, createdAt: '2026-10-12T08:10:00.000Z' }],
};
/** Current, on an expanded context line outside step 4's hunks: the file header, no tag. */
const ON_CONTEXT: Thread = {
  id: 'c-file',
  resolvable: true,
  resolved: false,
  outdated: false,
  position: { oldPath: VM, newPath: VM, newLine: 5, headSha: '9c41e07', baseSha: '5e2a9c4' },
  notes: [{ id: 9103, author: ANNA, body: CONTEXT_BODY, createdAt: '2026-10-12T08:20:00.000Z' }],
};

const real = createMockClient({ latencyMs: 0, review: { planCached: true } });

/** The mock backend whose step views are changed by `patch`. */
function backend(patch: (view: StepView) => StepView): IpcClient {
  return {
    ...real,
    reviewStep: async (sessionId, stepId) => patch(await real.reviewStep(sessionId, stepId)),
  };
}

function renderStep(ipc: IpcClient, step: string) {
  const router = createMemoryRouter(
    [{ path: '/session/:sessionId/step', element: <StepScreen /> }],
    { initialEntries: [`/session/${SESSION}/step?step=${step}`] },
  );
  render(
    <IpcProvider client={ipc}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </IpcProvider>,
  );
}

const fileOf = () => screen.findByRole('region', { name: VM });

describe('S-03 threads on outdated lines (F-11.3)', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-11.3 an outdated thread shows under its placed line with the Outdated tag, labelled with that line', async () => {
    renderStep(
      backend((v) => ({ ...v, threads: [...v.threads, ON_LINE] })),
      's4',
    );
    const card = await screen.findByRole('region', { name: 'Thread at line 14' });
    expect(card).toHaveTextContent(LINE_BODY);
    expect(within(card).getByText('Outdated', { exact: true })).toBeInTheDocument();
    // The gutter icon is on the placed line, not on the line it was written on.
    expect(
      await screen.findByRole('button', { name: 'Thread by Anna K. at line 14' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('region', { name: 'Thread at line 9' })).toBeNull();
    // Under line 14 itself: the line is in the file and comes before the card.
    const line = (await fileOf()).querySelector('[data-kind="add"] [data-line-no="14"]');
    expect(line).not.toBeNull();
    expect(
      (line?.compareDocumentPosition(card) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The current thread of line 48 has no tag.
    const current = screen.getByRole('region', { name: 'Thread at line 48' });
    expect(within(current).queryByText('Outdated')).toBeNull();
  });

  it('F-11.3 an outdated thread that was resolved shows the Outdated and the Resolved tags and Reopen', async () => {
    const resolved: Thread = { ...ON_LINE, resolved: true };
    renderStep(
      backend((v) => ({ ...v, threads: [...v.threads, resolved] })),
      's4',
    );
    const card = await screen.findByRole('region', { name: 'Thread at line 14' });
    expect(within(card).getByText('Outdated', { exact: true })).toBeInTheDocument();
    expect(within(card).getByText('Resolved', { exact: true })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
  });

  it('F-11.3 a thread without a matching line is a card on the file header, above the diff, with the Outdated tag', async () => {
    renderStep(
      backend((v) => ({ ...v, fileThreads: [ON_FILE] })),
      's4',
    );
    const file = await fileOf();
    const card = await within(file).findByRole('region', { name: `Thread on ${VM}` });
    expect(card).toHaveTextContent(FILE_BODY);
    expect(within(card).getByText('Marta K.', { selector: 'b' })).toBeInTheDocument();
    expect(within(card).getByText('Outdated', { exact: true })).toBeInTheDocument();
    // After the file's path and before the first line of the diff.
    const path = within(file).getByText(VM, { exact: true });
    const first = file.querySelector('[data-line-no]');
    expect(first).not.toBeNull();
    expect(path.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      card.compareDocumentPosition(first as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // It is not on a line: no gutter icon and no line card for it.
    expect(screen.queryByRole('button', { name: /^Thread by Marta K\./ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Thread at line 60' })).toBeNull();
  });

  it('F-11.3 a current thread outside the hunks is on the file header without the Outdated tag; several header cards keep their order', async () => {
    renderStep(
      backend((v) => ({ ...v, fileThreads: [ON_FILE, ON_CONTEXT] })),
      's4',
    );
    const file = await fileOf();
    const cards = await within(file).findAllByRole('region', { name: `Thread on ${VM}` });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent(FILE_BODY);
    expect(cards[1]).toHaveTextContent(CONTEXT_BODY);
    expect(
      within(cards[0] as HTMLElement).getByText('Outdated', { exact: true }),
    ).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).queryByText('Outdated')).toBeNull();
  });

  it('F-11.3 a header card has the thread actions, and Resolve goes to GitLab with its discussion', async () => {
    const ipc = backend((v) => ({ ...v, fileThreads: [ON_FILE] }));
    const resolveCall = vi.spyOn(ipc, 'gitlabResolve').mockResolvedValue(undefined);
    renderStep(ipc, 's4');
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
