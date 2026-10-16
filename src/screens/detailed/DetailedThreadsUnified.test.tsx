import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { Thread } from '../../ipc/types/Thread';
import { useDetailedStore } from '../../state/detailed';
import { renderApp } from '../../test/renderApp';

// F-11.1 on S-04 in the FileBar's Unified layout: a thread on a removed line (a GitLab position
// with only `oldLine`) gets its gutter thread icon on the old-side number, as it does in Split,
// so the card under the line can be closed and opened again. The split cases are in
// DetailedThreads.test.tsx.

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';

/** A mock backend of its own, with the session's plan prepared as S-02 does. */
async function backend() {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  await ipc.reviewPlan(SESSION, () => undefined);
  return ipc;
}

/** S-04 on step 4 of !482, which holds the thread at `_worker.Kick()`. */
async function openDetailed(client: Partial<IpcClient>) {
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=s4`);
  await screen.findByRole('heading', { level: 1 });
  return app;
}

const fileOf = (path: string) => screen.getByRole('region', { name: path });
/** The virtual rows of a file's diff, in order (`data-index`; a card sits in a row of its own). */
const rowsOf = (file: HTMLElement) => Array.from(file.querySelectorAll('[data-index]'));

describe('S-04 threads in the unified layout (F-11.1)', () => {
  beforeEach(() => {
    useDetailedStore.setState({ layout: 'unified' });
    // jsdom lays nothing out; a measured diff row is one line high and the column is tall.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-11.1 a thread on a removed line has its icon on that line in the unified layout', async () => {
    const ipc = await backend();
    // The mock's thread, moved to the removed `await _api.UploadPhotoAsync(...)` (old line 37).
    const reviewStep: IpcClient['reviewStep'] = async (id, stepId) => {
      const view = await ipc.reviewStep(id, stepId);
      return {
        ...view,
        threads: view.threads.map((thread): Thread => ({
          ...thread,
          position: { oldPath: VM, newPath: VM, oldLine: 37, headSha: '9c41e07' },
        })),
      };
    };
    await openDetailed({ ...ipc, reviewStep });

    const card = await screen.findByRole('region', { name: 'Thread at line 37' });
    const rows = rowsOf(fileOf(VM));
    const at = rows.findIndex((row) => row.contains(card));
    expect(at).toBeGreaterThan(0);
    expect(rows[at - 1]?.querySelector('[data-kind="del"] [data-line-no="37"]')).not.toBeNull();

    // The icon is on the removed line's old-side number, in the row right above the card.
    const mark = await screen.findByRole('button', { name: 'Thread by Paweł S. at line 37' });
    expect(mark.closest('[data-line-no]')).toHaveAttribute('data-line-no', '37');
    expect(mark.closest('[data-kind]')).toHaveAttribute('data-kind', 'del');
    expect(rows[at - 1]).toContainElement(mark);
    expect(mark).toHaveAttribute('aria-expanded', 'true');

    // The icon is the card's only toggle: it closes it and opens it again.
    await userEvent.click(mark);
    expect(mark).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Thread at line 37' })).toBeNull();
    await userEvent.click(mark);
    expect(mark).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('region', { name: 'Thread at line 37' })).toBeInTheDocument();
  });
});
