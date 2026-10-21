import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import { createMockClient } from '../../ipc/mock';
import { renderApp } from '../../test/renderApp';

// F-26.2 edges the locked tests leave open (autopilot decision): a thread on a removed line has
// its file but no line in the working tree; its bar reads "Open in Rider" (no line) and opens
// the file at its top; the card still shows, above the code (no row to sit under).

const PATH = 'src/App/Workers/UploadWorker.cs';

async function openRemovedLineThread() {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const mr = await base.authorMr('mobile/mobile-app', 480);
  const [first] = mr.threads;
  if (!first) throw new Error('the mock has threads');
  const authorMr = vi.fn(() =>
    Promise.resolve({ ...mr, threads: [{ ...first, line: null, place: 'UploadWorker.cs' }] }),
  );
  const riderOpen = vi.fn(() => Promise.resolve());
  const app = renderApp({ screen: 'S-01' }, { ...base, authorMr, riderOpen });
  await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: 480 })));
  return { riderOpen };
}

describe('S-10 thread on a removed line (F-26.2)', () => {
  it('F-26.2 a thread without a working-tree line offers “Open in Rider” at the top of its file', async () => {
    const { riderOpen } = await openRemovedLineThread();

    const open = await screen.findByRole('button', { name: 'Open in Rider' });
    await userEvent.click(open);

    expect(riderOpen).toHaveBeenCalledWith(PATH, 1);
    const card = await screen.findByRole('region', { name: 'Thread' });
    expect(within(card).getByRole('button', { name: 'Fix in Rider' })).toBeEnabled();
  });
});
