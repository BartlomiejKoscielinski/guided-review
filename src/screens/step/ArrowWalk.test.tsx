import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BANNER,
  CONVERTER,
  PHOTO_SERVICE,
  VM,
  currentChange,
  down,
  expectCurrent,
  expectCurrentLine,
  expectFilePressed,
  expectStepReviewed,
  held,
  left,
  mockLayout,
  openFocus,
  press,
  right,
  up,
} from '../../test/walk';

// F-30.6 on S-03 (M4 decisions 14 and 15, the owner's keymap of 2026-10-16): `↓`/`↑` walk the
// changes of the step (the current change has the focus outline, `aria-current`), past a file's
// last change `↓` marks the file reviewed and goes on, `→`/`←` move between the step's files
// without marking. The tall-change scroll is in tests/e2e/step-f30-6.spec.ts (a real layout).

/** Lets pending key effects (a navigation, a mark) run before checking that nothing changed. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

async function expectStep(router: { state: { location: { search: string } } }, step: string) {
  expect(await screen.findByText(`Step ${step.slice(1)} of 8`)).toBeInTheDocument();
  expect(router.state.location.search).toBe(`?step=${step}`);
}

describe('S-03 arrow-key walk (F-30.6)', () => {
  let restore: () => void;

  beforeEach(() => {
    restore = mockLayout();
  });

  afterEach(() => {
    restore();
  });

  it('F-30.6 ↓ walks the changes of a step in diff order, a closed fold counting as one stop', async () => {
    const { calls } = await openFocus('s4');
    expect(currentChange()).toBeNull();
    await down();
    await expectCurrent((current) => {
      expect(current.file).toBe(VM);
      expect(current.text).toContain('Fields and constructor');
    });
    // The fold counts as one stop and stays closed.
    expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument();
    await down();
    await expectCurrentLine(VM, 39);
    await down();
    await expectCurrentLine(VM, 61);
    // Nothing is marked on the way to the file's last change.
    await expectFilePressed(VM, false);
    expect(calls.file).toEqual([]);
  });

  it('F-30.6 ↑ walks back over the changes', async () => {
    await openFocus('s4');
    await down();
    await down();
    await down();
    await expectCurrentLine(VM, 61);
    await up();
    await expectCurrentLine(VM, 39);
    await up();
    await expectCurrent((current) => {
      expect(current.text).toContain('Fields and constructor');
    });
  });

  it('F-30.6 past a file’s last change ↓ marks the file reviewed and goes to the next file’s first change', async () => {
    const { calls } = await openFocus('s5');
    await down();
    await expectCurrent((current) => {
      expect(current.file).toBe(CONVERTER);
    });
    // On the file's last change it is not marked yet.
    await expectFilePressed(CONVERTER, false);
    await down();
    await expectFilePressed(CONVERTER, true);
    await expectCurrent((current) => {
      expect(current.file).toBe(BANNER);
    });
    await expectFilePressed(BANNER, false);
    await expectStepReviewed(false);
    expect(calls.file).toEqual([['mock-mr-session-1', 's5', CONVERTER, true]]);
    expect(calls.step).toEqual([]);
  });

  it('F-30.6 ↑ goes back over a file boundary and never unmarks', async () => {
    const { calls } = await openFocus('s5');
    await down();
    await down();
    await expectFilePressed(CONVERTER, true);
    await up();
    await expectCurrent((current) => {
      expect(current.file).toBe(CONVERTER);
    });
    await settle();
    await expectFilePressed(CONVERTER, true);
    await expectFilePressed(BANNER, false);
    expect(calls.file.map((call) => call[3])).not.toContain(false);
  });

  it('F-30.6 past the step’s last file ↓ marks it and pauses: the step shows as reviewed and stays', async () => {
    const { router, calls } = await openFocus('s5');
    await down();
    await down();
    await down();
    await expectFilePressed(BANNER, true);
    await expectStepReviewed(true);
    await settle();
    await expectStep(router, 's5');
    expect(calls.file).toEqual([
      ['mock-mr-session-1', 's5', CONVERTER, true],
      ['mock-mr-session-1', 's5', BANNER, true],
    ]);
  });

  it('F-30.6 the next ↓ opens the next step at its first change', async () => {
    const { router } = await openFocus('s5');
    await down();
    await down();
    await down();
    await expectStepReviewed(true);
    await down();
    await expectStep(router, 's6');
    await expectCurrent((current) => {
      expect(current.file).toBe(PHOTO_SERVICE);
    });
    // The step it left stays reviewed.
    await router.navigate('/session/mock-mr-session-1/step?step=s5');
    await expectStepReviewed(true);
  });

  it('F-30.6 ↑ at a step’s first change pauses once, then opens the previous step at its last change', async () => {
    const { router, calls } = await openFocus('s5');
    await down();
    await expectCurrent((current) => {
      expect(current.file).toBe(CONVERTER);
    });
    await up();
    await settle();
    // The pause: the step stays and its first change stays current.
    await expectStep(router, 's5');
    expect(currentChange()?.file).toBe(CONVERTER);
    await up();
    await expectStep(router, 's4');
    await expectCurrentLine(VM, 61);
    expect(calls.file).toEqual([]);
    expect(calls.step).toEqual([]);
  });

  it('F-30.6 a held ↓ walks the file’s changes but stops at its end; a new press marks it', async () => {
    const { router, calls } = await openFocus('s4');
    await down();
    await expectCurrent((current) => {
      expect(current.text).toContain('Fields and constructor');
    });
    held('ArrowDown');
    await expectCurrentLine(VM, 39);
    held('ArrowDown');
    await expectCurrentLine(VM, 61);
    // The file's last change: the repeats go no further and mark nothing.
    held('ArrowDown');
    held('ArrowDown');
    held('ArrowDown');
    await settle();
    await expectCurrentLine(VM, 61);
    await expectFilePressed(VM, false);
    expect(calls.file).toEqual([]);
    await expectStep(router, 's4');
    await down();
    await expectFilePressed(VM, true);
    await expectStepReviewed(true);
  });

  it('F-30.6 open notes do not stop the marking: ↓ marks the file and decides no note', async () => {
    const { calls } = await openFocus('s4');
    for (let n = 0; n < 4; n++) await down();
    await expectFilePressed(VM, true);
    await expectStepReviewed(true);
    expect(calls.decide).toEqual([]);
    expect(screen.getAllByRole('article', { name: /^Claude note:/ }).length).toBeGreaterThan(0);
  });

  it('F-30.6 → and ← move between the step’s files without marking, stopping at its ends', async () => {
    const { router, calls } = await openFocus('s5');
    // Before any move the first file is the current one: → goes to the second.
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
    await expectFilePressed(CONVERTER, false);
    await expectFilePressed(BANNER, false);
    await expectStepReviewed(false);
    expect(calls.file).toEqual([]);
    expect(calls.step).toEqual([]);
    await expectStep(router, 's5');
  });

  it('F-30.6 → makes the next file’s first change current', async () => {
    await openFocus('s6');
    await right();
    await expectCurrent((current) => {
      expect(current.file).toBe('src/Mobile.Infrastructure/DependencyInjection.cs');
    });
  });

  it('F-30.6 Space toggles the current file and does not move; a mark made with Space stays when ↓ passes it', async () => {
    const { calls } = await openFocus('s5');
    await right();
    await expectCurrent((current) => {
      expect(current.file).toBe(BANNER);
    });
    await press(' ');
    await expectFilePressed(BANNER, true);
    await expectFilePressed(CONVERTER, false);
    expect(currentChange()?.file).toBe(BANNER);
    await press(' ');
    await expectFilePressed(BANNER, false);

    await left();
    await press(' ');
    await expectFilePressed(CONVERTER, true);
    // ↓ past the already marked file keeps its mark (it marks, never toggles).
    await down();
    await down();
    await expectCurrent((current) => {
      expect(current.file).toBe(BANNER);
    });
    await expectFilePressed(CONVERTER, true);
    expect(calls.file.filter((call) => call[2] === CONVERTER).map((call) => call[3])).not.toContain(
      false,
    );
  });

  it('F-30.6 the arrow keys do nothing with Ctrl, Alt or Shift held', async () => {
    const { router } = await openFocus('s5');
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft']) {
      for (const modifier of ['Control', 'Alt', 'Shift']) {
        await press(`{${modifier}>}{${key}}{/${modifier}}`);
      }
    }
    await settle();
    expect(currentChange()).toBeNull();
    await expectStep(router, 's5');
    await down();
    await expectCurrent((current) => {
      expect(current.file).toBe(CONVERTER);
    });
  });

  it('F-30.6 the arrow keys type in a text field and walk nothing there', async () => {
    const { calls } = await openFocus('s5');
    await down();
    await expectCurrent((current) => {
      expect(current.file).toBe(CONVERTER);
    });
    await press('a');
    const ask = await screen.findByRole('textbox', { name: 'Ask Claude about this step' });
    expect(ask).toHaveFocus();
    await press('{ArrowDown}{ArrowDown}{ArrowRight}{ArrowLeft}{ArrowUp}');
    await settle();
    expect(currentChange()?.file).toBe(CONVERTER);
    await expectFilePressed(CONVERTER, false);
    expect(calls.file).toEqual([]);
  });

  it('F-30.6 the arrow keys stay with menus, list boxes, radio groups and selects', async () => {
    const { calls } = await openFocus('s5');
    await down();
    await expectCurrent((current) => {
      expect(current.file).toBe(CONVERTER);
    });
    const widgets: [string, string][] = [
      ['menu', '<div role="menu"><button role="menuitem" type="button">Item</button></div>'],
      [
        'listbox',
        '<div role="listbox"><div role="option" tabindex="0" aria-selected="false">Item</div></div>',
      ],
      [
        'radiogroup',
        '<div role="radiogroup"><button role="radio" aria-checked="false" type="button">Item</button></div>',
      ],
      ['select', '<select><option>Item</option><option>Other</option></select>'],
    ];
    for (const [, html] of widgets) {
      const host = document.createElement('div');
      host.innerHTML = html;
      document.body.append(host);
      const target = host.querySelector<HTMLElement>('button, [tabindex], select');
      target?.focus();
      expect(target).toHaveFocus();
      await press('{ArrowDown}{ArrowUp}{ArrowRight}{ArrowLeft}');
      host.remove();
    }
    await settle();
    expect(currentChange()?.file).toBe(CONVERTER);
    await expectFilePressed(CONVERTER, false);
    expect(calls.file).toEqual([]);
  });

  it('F-30.6 the handled arrows are not left to the browser, so the diff does not scroll line by line', async () => {
    await openFocus('s4');
    const sent = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      act(() => {
        document.body.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };
    expect(sent('ArrowDown')).toBe(true);
    expect(sent('ArrowUp')).toBe(true);
    // The wheel, PageUp/PageDown and Home/End still scroll.
    for (const key of ['PageDown', 'PageUp', 'Home', 'End']) expect(sent(key)).toBe(false);
  });

  it('F-30.6 ], [, J and K are removed: they neither open a step nor move the current change', async () => {
    const { router } = await openFocus('s5');
    await press(']');
    await press('[[');
    await press('j');
    await press('k');
    await settle();
    expect(currentChange()).toBeNull();
    await expectStep(router, 's5');
  });

  it('F-30.6 the walk works in layouts B and C', async () => {
    for (const layout of ['B', 'C'] as const) {
      const { unmount } = await openFocus('s5', { layout });
      await down();
      await expectCurrent((current) => {
        expect(current.file).toBe(CONVERTER);
      });
      await down();
      await expectFilePressed(CONVERTER, true);
      await expectCurrent((current) => {
        expect(current.file).toBe(BANNER);
      });
      unmount();
    }
  });

  it('F-30.6 ↓ walks while a button has the focus', async () => {
    await openFocus('s5');
    screen.getByRole('button', { name: 'Mark reviewed' }).focus();
    expect(screen.getByRole('button', { name: 'Mark reviewed' })).toHaveFocus();
    await down();
    await expectCurrent((current) => {
      expect(current.file).toBe(CONVERTER);
    });
  });
});
