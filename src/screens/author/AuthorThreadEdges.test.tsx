import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import { createMockClient } from '../../ipc/mock';
import { renderApp } from '../../test/renderApp';

// F-26.2 edges the locked tests leave open (autopilot decision): a thread on a removed line has
// its file but no line in the working tree; its bar reads "Open in Rider" (no line) and opens
// the file at its top. The removed line is still a del row of the unified diff (merge-base →
// working tree), so the card sits under that row.

const PATH = 'src/App/Workers/UploadWorker.cs';

async function openRemovedLineThread() {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const mr = await base.authorMr('mobile/mobile-app', 480);
  const [first] = mr.threads;
  if (!first) throw new Error('the mock has threads');
  const authorMr = vi.fn(() =>
    Promise.resolve({
      ...mr,
      threads: [{ ...first, line: null, oldLine: 36, place: 'UploadWorker.cs:36' }],
    }),
  );
  const riderOpen = vi.fn(() => Promise.resolve());
  const app = renderApp({ screen: 'S-01' }, { ...base, authorMr, riderOpen });
  await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: 480 })));
  return { riderOpen };
}

/** The diff row of a kind and line number (new number for add, old for del). */
const row = (kind: 'add' | 'del', no: number) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[data-kind="${kind}"]`)).find((r) =>
    r.querySelector(`[data-line-no="${String(no)}"]`),
  );
/** True when `later` comes after `earlier` in the document. */
const after = (earlier: Node, later: Node) =>
  (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('S-10 thread on a removed line (F-26.2)', () => {
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

  it('F-26.2 a thread without a working-tree line offers “Open in Rider” at the top of its file', async () => {
    const { riderOpen } = await openRemovedLineThread();

    const open = await screen.findByRole('button', { name: 'Open in Rider' });
    await userEvent.click(open);

    expect(riderOpen).toHaveBeenCalledWith(PATH, 1);
    const card = await screen.findByRole('region', { name: 'Thread' });
    expect(within(card).getByRole('button', { name: 'Fix in Rider' })).toBeEnabled();
  });

  it('F-26.2 a thread on a removed line sits right under that del row, not above the code', async () => {
    await openRemovedLineThread();

    await vi.waitFor(() => {
      const removed = row('del', 36);
      const next = row('add', 36);
      if (!removed || !next) throw new Error('the diff rows around old line 36 are missing');
      const card = screen.getByRole('region', { name: 'Thread' });
      expect(after(removed, card)).toBe(true);
      expect(after(card, next)).toBe(true);
    });
    expect(screen.getAllByRole('region', { name: 'Thread' })).toHaveLength(1);
  });
});
