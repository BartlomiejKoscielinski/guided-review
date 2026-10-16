import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import { createMockClient } from '../../ipc/mock';
import { renderApp } from '../../test/renderApp';
import {
  BANNER,
  CONVERTER,
  PHOTO_SERVICE,
  SESSION,
  VM,
  currentChange,
  down,
  expectCurrent,
  expectFilePressed,
  expectStepReviewed,
  left,
  mockLayout,
  noteInThirdHunk,
  openDetailed,
  press,
  right,
  selfReview,
  up,
} from '../../test/walk';

// F-30.6 on S-04 (M4 decisions 14 and 15): the same walk as on S-03, with the focus outline on the
// hunk header of the current change; at the end of a step the end-of-step card is the pause.

const HUNK_1 = 'lines 12–31 · DeliveryPhotoViewModel';
const HUNK_2 = 'lines 39–60 · SendPhotoAsync';
const HUNK_3 = 'lines 61–74 · RetryAsync';

/** Lets pending key effects run before checking that nothing changed. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

const expectHunk = (label: string) =>
  expectCurrent((current) => {
    expect(current.text).toContain(label);
  });

async function expectStep(router: { state: { location: { search: string } } }, step: string) {
  expect(await screen.findByText(`Step ${step.slice(1)} / 8`)).toBeInTheDocument();
  expect(router.state.location.search).toBe(`?step=${step}`);
}

const mainColumn = () => {
  const main = document.querySelector<HTMLElement>('main main');
  if (!main) throw new Error('no S-04 main column');
  return main;
};

describe('S-04 arrow-key walk (F-30.6)', () => {
  let restore: () => void;

  beforeEach(() => {
    restore = mockLayout();
  });

  afterEach(() => {
    restore();
  });

  it('F-30.6 ↓ and ↑ walk the changes, the outline on each hunk header', async () => {
    const { calls } = await openDetailed('s4');
    expect(await screen.findByText(HUNK_1)).toBeInTheDocument();
    expect(currentChange()).toBeNull();
    await down();
    await expectHunk(HUNK_1);
    await down();
    await expectHunk(HUNK_2);
    await down();
    await expectHunk(HUNK_3);
    await up();
    await expectHunk(HUNK_2);
    await up();
    await expectHunk(HUNK_1);
    await expectFilePressed(VM, false);
    expect(calls.file).toEqual([]);
  });

  it('F-30.6 past a file’s last change ↓ marks it, goes on, pauses at the step’s end and then opens the next step', async () => {
    const { router, calls } = await openDetailed('s5');
    await down();
    await expectCurrent((current) => {
      expect(current.file).toBe(CONVERTER);
    });
    await expectFilePressed(CONVERTER, false);
    await down();
    await expectFilePressed(CONVERTER, true);
    await expectCurrent((current) => {
      expect(current.file).toBe(BANNER);
    });
    await down();
    await expectFilePressed(BANNER, true);
    await expectStepReviewed(true);
    await settle();
    // The pause: the step stays, the end-of-step card is what is shown.
    await expectStep(router, 's5');
    expect(within(mainColumn()).getByText('End of step 5')).toBeInTheDocument();
    expect(calls.file).toEqual([
      [SESSION, 's5', CONVERTER, true],
      [SESSION, 's5', BANNER, true],
    ]);
    await down();
    await expectStep(router, 's6');
    await expectCurrent((current) => {
      expect(current.file).toBe(PHOTO_SERVICE);
    });
  });

  it('F-30.6 ↑ at a step’s first change pauses once, then opens the previous step at its last change; it never unmarks', async () => {
    const { router, calls } = await openDetailed('s5');
    await down();
    await down();
    await expectFilePressed(CONVERTER, true);
    await up();
    await expectCurrent((current) => {
      expect(current.file).toBe(CONVERTER);
    });
    await expectFilePressed(CONVERTER, true);
    await up();
    await settle();
    await expectStep(router, 's5');
    await up();
    await expectStep(router, 's4');
    await expectHunk(HUNK_3);
    expect(calls.file.map((call) => call[3])).not.toContain(false);
  });

  it('F-30.6 → and ← move between the files without marking, stopping at the ends', async () => {
    const { router, calls } = await openDetailed('s5');
    await right();
    await expectCurrent((current) => {
      expect(current.file).toBe(BANNER);
    });
    await right();
    await settle();
    expect(currentChange()?.file).toBe(BANNER);
    await left();
    await expectCurrent((current) => {
      expect(current.file).toBe(CONVERTER);
    });
    await left();
    await settle();
    expect(currentChange()?.file).toBe(CONVERTER);
    await expectStepReviewed(false);
    expect(calls.file).toEqual([]);
    await expectStep(router, 's5');
  });

  it('F-30.6 Space marks the current file only and does not move', async () => {
    await openDetailed('s5');
    await right();
    await expectCurrent((current) => {
      expect(current.file).toBe(BANNER);
    });
    await press(' ');
    await expectFilePressed(BANNER, true);
    await expectFilePressed(CONVERTER, false);
    expect(currentChange()?.file).toBe(BANNER);
  });

  it('F-30.6 D and X act on the note of the current change', async () => {
    const { calls } = await openDetailed('s4', { wrap: noteInThirdHunk });
    expect(await screen.findByText(HUNK_3)).toBeInTheDocument();
    await down();
    await down();
    await down();
    await expectHunk(HUNK_3);
    await press('d');
    await waitFor(() => {
      expect(calls.decide).toEqual([[SESSION, 'f4', { kind: 'addToDrafts' }]]);
    });
  });

  it('F-30.6 ↓ ignores Ctrl, Alt and Shift and a text field; the handled arrows are left out of the browser', async () => {
    await openDetailed('s5');
    for (const modifier of ['Control', 'Alt', 'Shift']) {
      await press(`{${modifier}>}{ArrowDown}{/${modifier}}`);
    }
    await settle();
    expect(currentChange()).toBeNull();
    const sent = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      act(() => {
        document.body.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };
    expect(sent('ArrowDown')).toBe(true);
    await expectCurrent((current) => {
      expect(current.file).toBe(CONVERTER);
    });
    for (const key of ['PageDown', 'PageUp', 'Home', 'End']) expect(sent(key)).toBe(false);
    const ask = screen.getByLabelText('Ask about this step or the selected code');
    act(() => {
      ask.focus();
    });
    await press('{ArrowDown}{ArrowDown}{ArrowRight}');
    await settle();
    expect(currentChange()?.file).toBe(CONVERTER);
    await expectFilePressed(CONVERTER, false);
  });

  it('F-30.6 ], [, J and K are removed: they neither open a step nor move the current change', async () => {
    const { router } = await openDetailed('s5');
    await press(']');
    await press('[[');
    await press('j');
    await press('k');
    await settle();
    expect(currentChange()).toBeNull();
    await expectStep(router, 's5');
  });

  it('F-30.6 ↓ on an S-04 freshly mounted by Ctrl+D scrolls the main column to the change', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    await ipc.repoPick();
    const app = renderApp({ screen: 'S-03', sessionId: SESSION }, ipc);
    await app.router.navigate(`/session/${SESSION}/step?step=s4`);
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
    await press('{Control>}d{/Control}');
    expect(await screen.findByText('Step 4 / 8')).toBeInTheDocument();
    expect(await screen.findByText(HUNK_3)).toBeInTheDocument();
    // No layout in jsdom: any scroll request of the main column counts, whatever asks for it.
    const scrollTo = vi.fn();
    const scrollBy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: scrollTo,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollBy', {
      configurable: true,
      writable: true,
      value: scrollBy,
    });
    try {
      await down();
      await expectHunk(HUNK_1);
      expect(scrollTo.mock.calls.length + scrollBy.mock.calls.length).toBeGreaterThan(0);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollBy');
    }
  });

  it('F-30.6 at the end of the last step ↓ moves the focus to the end card’s Finish review; Enter opens S-05', async () => {
    const { ipc, sessionId } = await selfReview();
    const app = renderApp({ screen: 'S-01' }, ipc);
    await act(() => app.router.navigate(`${pathFor({ screen: 'S-04', sessionId })}?step=s8`));
    expect(await screen.findByText('Step 8 / 8')).toBeInTheDocument();
    const finish = () => within(mainColumn()).getByRole('button', { name: 'Finish review' });
    await within(mainColumn()).findByRole('button', { name: 'Finish review' });
    let presses = 0;
    while (presses < 12 && document.activeElement !== finish()) {
      await down();
      presses += 1;
      await settle();
    }
    expect(finish()).toHaveFocus();
    // First change, the file marks and the step pauses reviewed, then the focus moves.
    expect(presses).toBeGreaterThanOrEqual(3);
    expect(app.router.state.location.pathname).toBe(pathFor({ screen: 'S-04', sessionId }));
    await expectStepReviewed(true);
    await press('{Enter}');
    await waitFor(() => {
      expect(app.router.state.location.pathname).toBe(pathFor({ screen: 'S-05', sessionId }));
    });
    expect(await screen.findByText('Nothing to fix.')).toBeInTheDocument();
    expect(await screen.findByText('1 of 8 steps reviewed.')).toBeInTheDocument();
  });
});
