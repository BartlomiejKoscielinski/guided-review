import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { StepView } from '../../ipc/types/StepView';
import type { Thread } from '../../ipc/types/Thread';
import { useDetailedStore } from '../../state/detailed';
import { renderApp } from '../../test/renderApp';

// F-11.3 on S-04 as on S-03 (M5 decisions 3 and 4, no diff thread disappears from the review):
// a thread written on the old name of a file renamed later shows on the renamed file (matched by
// its old path, as `thread_place::same_file`); a thread on a line of a mechanical hunk cuts its
// line and 3 lines on each side out of the fold, so the card shows with the lines around it and
// the rest of the hunk still folded.

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const RENAMED = 'src/Mobile.App/ViewModels/PhotoUploadViewModel.cs';
const ANNA = { username: 'anna.k', name: 'Anna K.' };
const MARTA = { username: 'marta.k', name: 'Marta K.' };
const LINE_BODY = 'Should the pending count refresh here as well?';
const FILE_BODY = 'This block moved after my first look. Is the null check still needed?';

const ON_LINE: Thread = {
  id: 'p-line',
  resolvable: true,
  resolved: false,
  outdated: true,
  placedLine: 14,
  position: { oldPath: VM, newPath: VM, newLine: 9, headSha: '3b8d1f0', baseSha: '5e2a9c4' },
  notes: [{ id: 9301, author: ANNA, body: LINE_BODY, createdAt: '2026-10-12T08:00:00.000Z' }],
};
const ON_FILE: Thread = {
  id: 'p-file',
  resolvable: true,
  resolved: false,
  outdated: true,
  position: { oldPath: VM, newPath: VM, newLine: 60, headSha: '3b8d1f0', baseSha: '5e2a9c4' },
  notes: [{ id: 9302, author: MARTA, body: FILE_BODY, createdAt: '2026-10-12T08:10:00.000Z' }],
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

/** The view model's files changed by `change`. */
const withVm = (view: StepView, change: (file: FileDiff) => FileDiff): StepView => ({
  ...view,
  files: view.files.map((f) => (f.newPath === VM ? change(f) : f)),
});

/** S-04 on step 4 of the session. */
async function openDetailed(client: IpcClient) {
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=s4`);
  await screen.findByRole('heading', { level: 1 });
  return app;
}

describe('S-04 threads placed as in S-03 (F-11.3)', () => {
  beforeEach(() => {
    useDetailedStore.setState({ layout: 'split' });
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows (as
    // DetailedThreadsOutdated.test.tsx).
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-11.3 a thread on the old name of a renamed file shows on its placed line and on the file header of the renamed file', async () => {
    await openDetailed(
      await backend((v) => ({
        ...withVm(v, (f) => ({ ...f, oldPath: VM, newPath: RENAMED, status: 'renamed' })),
        threads: [...v.threads, ON_LINE],
        fileThreads: [ON_FILE],
      })),
    );
    const file = await screen.findByRole('region', { name: RENAMED });
    const line = await within(file).findByRole('region', { name: 'Thread at line 14' });
    expect(line).toHaveTextContent(LINE_BODY);
    const header = await within(file).findByRole('region', { name: `Thread on ${RENAMED}` });
    expect(header).toHaveTextContent(FILE_BODY);
  });

  it('F-11.3 a thread on a line of a mechanical hunk shows under its line with 3 lines on each side, the rest of the hunk stays folded', async () => {
    await openDetailed(
      await backend((v) => ({
        ...withVm(v, (f) => ({
          ...f,
          hunks: f.hunks.map((h) =>
            14 >= h.newStart && 14 < h.newStart + h.newLines
              ? { ...h, mechanical: 'whitespace' }
              : h,
          ),
        })),
        threads: [...v.threads, ON_LINE],
      })),
    );
    const file = await screen.findByRole('region', { name: VM });
    const card = await within(file).findByRole('region', { name: 'Thread at line 14' });
    expect(card).toHaveTextContent(LINE_BODY);
    expect(file.querySelector('[data-kind="add"] [data-line-no="14"]')).not.toBeNull();
    // 3 lines on each side of the thread's line show; the other lines of the hunk are still in a
    // closed fold.
    expect(file.querySelector('[data-kind="add"] [data-line-no="15"]')).not.toBeNull();
    expect(file.querySelector('[data-kind="ctx"] [data-line-no="17"]')).not.toBeNull();
    expect(file.querySelector('[data-kind="add"] [data-line-no="20"]')).toBeNull();
    expect(within(file).getAllByText('Whitespace only').length).toBeGreaterThan(0);
  });
});
