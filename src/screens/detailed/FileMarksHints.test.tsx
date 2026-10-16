import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import { createMockClient } from '../../ipc/mock';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-07.10 changes what S-04 advertises (M4 plan row F-07.10, decision 15): the footer hints follow
// the arrow-key walk (F-08.8: "↑ ↓ change, ← → file, Space file reviewed, N note, C comment, A ask,
// ? all shortcuts"), and the step header's Next step (F-08.4) loses its `]` hint. The header's
// Mark reviewed loses its Space hint too, since Space now toggles only the current file (decision
// 15), and the end-of-step card's Next step (F-08.9) keeps its `]` until F-30.6 removes the key.

const SESSION = 'mock-mr-session-1';

async function openDetailed(step = 's4') {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.reviewPlan(SESSION, () => undefined);
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, ipc);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=${step}`);
  await screen.findByRole('heading', { level: 1 });
  return app;
}

const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, '');

const footer = (): HTMLElement => {
  const el = document.querySelector('footer');
  if (!(el instanceof HTMLElement)) throw new Error('S-04 has no <footer>');
  return el;
};

/** S-04's main column (the shell's <main> holds the whole screen). */
function mainColumn(): HTMLElement {
  const main = document.querySelector<HTMLElement>('main main');
  if (!main) throw new Error('no S-04 main column');
  return main;
}

describe('S-04 hints after file marks (F-07.10)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-07.10 the footer hints are ↑ ↓ change, ← → file, Space file reviewed, N note, C comment, A ask, ? all shortcuts', async () => {
    await openDetailed();
    const keys = Array.from(footer().querySelectorAll('kbd')).map((k) => k.textContent);
    expect(keys).toEqual(['↑', '↓', '←', '→', 'Space', 'N', 'C', 'A', '?']);
    expect(squash(footer().textContent)).toContain(
      squash('↑ ↓ change ← → file Space file reviewed N note C comment A ask ? all shortcuts'),
    );
  });

  it('F-07.10 the step header’s Next step has no ] hint and Mark reviewed has no Space hint', async () => {
    await openDetailed();
    const [header] = screen.getAllByRole('button', { name: /^Next step/ });
    if (!header) throw new Error('no Next step button');
    expect(header).toHaveAccessibleName('Next step');
    expect(within(header).queryByText(']')).not.toBeInTheDocument();
    expect(header.querySelector('kbd')).toBeNull();
    // Space marks only the current file now (decision 15), so Mark reviewed (all the step's files)
    // names no key: a hint must name the key that does what the button does.
    const mark = screen.getByRole('button', { name: /^Mark reviewed/ });
    expect(mark).toHaveAccessibleName('Mark reviewed');
    expect(within(mark).queryByText('Space')).not.toBeInTheDocument();
    expect(mark.querySelector('kbd')).toBeNull();
  });

  it('F-07.10 the end-of-step card’s Next step keeps its ] hint until F-30.6', async () => {
    await openDetailed();
    expect(await screen.findByText('End of step 4')).toBeInTheDocument();
    const buttons = within(mainColumn()).getAllByRole('button', { name: /^Next step/ });
    expect(buttons).toHaveLength(2);
    expect(within(buttons[1] as HTMLElement).getByText(']')).toBeInTheDocument();
  });
});
