import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../ipc/client';
import { useFocusStore } from '../state/focus';
import { renderApp } from '../test/renderApp';
import { clientWithShortcuts, type ChangedShortcuts } from '../test/shortcutSettings';
import { pathFor } from './routes';

// F-19.7: changed shortcuts show in the footer hints and the button hints at once (M4 decision
// 16): S-04's footer, the Add to drafts and Dismiss buttons of its note callout, its "Code notes"
// hint, the Settings tile and the layout switch of the title bar, and S-01's source hint. The keys
// themselves are in ShortcutOverrides.test.tsx.

const SESSION = 'mock-mr-session-1';
const CALLOUT = 'Claude note at this line';

async function backend(changed: ChangedShortcuts): Promise<IpcClient> {
  const client = clientWithShortcuts(changed);
  await client.repoPick();
  await client.reviewPlan(SESSION, () => undefined);
  return client;
}

async function openDetailed(client: IpcClient) {
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=s4`);
  await screen.findByTestId('info-header');
  return app;
}

/** The S-04 footer (the shell's <main> holds it, so it has no contentinfo role). */
const footer = (): HTMLElement => {
  const el = document.querySelector('footer');
  if (!(el instanceof HTMLElement)) throw new Error('S-04 has no <footer>');
  return el;
};

const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, '');
const kbds = (root: Element) => Array.from(root.querySelectorAll('kbd')).map((k) => k.textContent);

describe('changed shortcuts in the hints (F-19.7)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out: a measured diff row is one line high and the column is tall, so
    // step 4's lines and its note callout render (as in detailed/NoteCallout.test).
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-19.7 the S-04 footer shows the changed keys, a chord as its keys, and keeps the other hints', async () => {
    await openDetailed(
      await backend({
        nextChange: ['J'],
        markFile: ['Ctrl', 'L'],
        nextNote: ['M'],
        ask: ['Q'],
      }),
    );
    await waitFor(() => {
      expect(kbds(footer())).toHaveLength(10);
    });
    expect(kbds(footer())).toEqual(['↑', 'J', '←', '→', 'Ctrl', 'L', 'M', 'C', 'Q', '?']);
    expect(squash(footer().textContent)).toContain(
      squash('↑ J change ← → file Ctrl L file reviewed M note C comment Q ask ? all shortcuts'),
    );
  });

  it('F-19.7 the note callout buttons show the changed keys of Add to drafts and Dismiss', async () => {
    await openDetailed(await backend({ addToDrafts: ['B'], dismissNote: ['Y'] }));
    const note = await screen.findByRole('region', { name: CALLOUT });
    expect(kbds(note)).toEqual(['B', 'Y']);
    expect(within(note).getByRole('button', { name: /^Add to drafts/ })).toHaveTextContent(/B$/);
    expect(within(note).getByRole('button', { name: /^Dismiss/ })).toHaveTextContent(/Y$/);
  });

  it('F-19.7 the "Code notes" hint shows the changed key of Next note', async () => {
    await openDetailed(await backend({ nextNote: ['M'] }));
    const guide = within(await screen.findByRole('complementary', { name: 'Guide' }));
    const notes = guide.getByRole('region', { name: 'Code notes' });
    expect(notes).toHaveTextContent(/in line order · M/);
    expect(within(notes).queryByText('N', { selector: 'kbd' })).toBeNull();
  });

  it('F-19.7 the Settings tile title shows the changed keys', async () => {
    renderApp({ screen: 'S-01' }, await backend({ settings: ['Ctrl', '.'] }));
    const tile = within(screen.getByRole('navigation', { name: 'App' })).getByRole('button', {
      name: /^Settings/,
    });
    await waitFor(() => {
      expect(tile).toHaveAttribute('title', 'Settings · Ctrl+.');
    });
  });

  it('F-19.7 the layout switch of the title bar shows the changed keys of the layout shortcuts', async () => {
    renderApp(
      { screen: 'S-03', sessionId: SESSION },
      await backend({ sidebarLayout: ['Ctrl', '4'], guideLayout: ['Ctrl', '6'] }),
    );
    const layout = within(await screen.findByRole('radiogroup', { name: 'Layout' }));
    expect(await layout.findByRole('radio', { name: 'Sidebar layout (Ctrl+4)' })).toBeChecked();
    expect(layout.getByRole('radio', { name: 'Minimal layout (Ctrl+2)' })).toBeInTheDocument();
    const guide = layout.getByRole('radio', { name: 'Guide layout (Ctrl+6)' });
    expect(guide).toHaveAttribute('title', 'Guide · Ctrl+6');
  });

  it("F-19.7 S-01's source hint shows the changed keys of Open anything", async () => {
    renderApp({ screen: 'S-01' }, await backend({ openAnything: ['Ctrl', 'J'] }));
    await screen.findByLabelText(/Paste a merge request link/);
    const hint = await screen.findByText(/opens this field from any screen/);
    await waitFor(() => {
      expect(kbds(hint)).toEqual(['Ctrl', 'J']);
    });
  });
});
