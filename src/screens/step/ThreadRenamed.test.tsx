import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../app/queryClient';
import type { IpcClient } from '../../ipc/client';
import { IpcProvider } from '../../ipc/IpcProvider';
import { createMockClient } from '../../ipc/mock';
import type { StepView } from '../../ipc/types/StepView';
import type { Thread } from '../../ipc/types/Thread';
import { StepScreen } from './StepScreen';

// F-11.3 on S-03 for a file renamed after the thread was written: GitLab keeps the thread on the
// old path (old and new path both the old name), the core matches it to the renamed file by its
// old path (`thread_place::same_file`), and S-03 shows it on that file, on its placed line or on
// the file header, never nowhere (M5 decision 4: no diff thread disappears from the review).

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const RENAMED = 'src/Mobile.App/ViewModels/PhotoUploadViewModel.cs';
const ANNA = { username: 'anna.k', name: 'Anna K.' };
const MARTA = { username: 'marta.k', name: 'Marta K.' };
const LINE_BODY = 'Should the pending count refresh here as well?';
const FILE_BODY = 'This block moved after my first look. Is the null check still needed?';

/** Written on the old name at version 3b8d1f0; the core placed it on line 14 of the new name. */
const ON_LINE: Thread = {
  id: 'r-line',
  resolvable: true,
  resolved: false,
  outdated: true,
  placedLine: 14,
  position: { oldPath: VM, newPath: VM, newLine: 9, headSha: '3b8d1f0', baseSha: '5e2a9c4' },
  notes: [{ id: 9201, author: ANNA, body: LINE_BODY, createdAt: '2026-10-12T08:00:00.000Z' }],
};
/** Written on the old name with no matching line in the renamed file: its file header. */
const ON_FILE: Thread = {
  id: 'r-file',
  resolvable: true,
  resolved: false,
  outdated: true,
  position: { oldPath: VM, newPath: VM, newLine: 60, headSha: '3b8d1f0', baseSha: '5e2a9c4' },
  notes: [{ id: 9202, author: MARTA, body: FILE_BODY, createdAt: '2026-10-12T08:10:00.000Z' }],
};

const real = createMockClient({ latencyMs: 0, review: { planCached: true } });

/** Step views where the view model was renamed from `VM` to `RENAMED`, with `threads` added. */
function renamed(extra: Pick<StepView, 'threads' | 'fileThreads'>): IpcClient {
  return {
    ...real,
    reviewStep: async (sessionId, stepId) => {
      const view = await real.reviewStep(sessionId, stepId);
      return {
        ...view,
        files: view.files.map((f) =>
          f.newPath === VM ? { ...f, oldPath: VM, newPath: RENAMED, status: 'renamed' } : f,
        ),
        threads: [...view.threads, ...extra.threads],
        fileThreads: [...view.fileThreads, ...extra.fileThreads],
      };
    },
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

describe('S-03 threads written before a rename (F-11.3)', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-11.3 a thread on the old name of a renamed file shows on its placed line of the renamed file', async () => {
    renderStep(renamed({ threads: [ON_LINE], fileThreads: [] }), 's4');
    const file = await screen.findByRole('region', { name: RENAMED });
    const card = await within(file).findByRole('region', { name: 'Thread at line 14' });
    expect(card).toHaveTextContent(LINE_BODY);
    expect(within(card).getByText('Outdated', { exact: true })).toBeInTheDocument();
  });

  it('F-11.3 a thread on the old name of a renamed file with no matching line is on the renamed file header', async () => {
    renderStep(renamed({ threads: [], fileThreads: [ON_FILE] }), 's4');
    const file = await screen.findByRole('region', { name: RENAMED });
    const card = await within(file).findByRole('region', { name: `Thread on ${RENAMED}` });
    expect(card).toHaveTextContent(FILE_BODY);
    expect(within(card).getByText('Outdated', { exact: true })).toBeInTheDocument();
  });
});
