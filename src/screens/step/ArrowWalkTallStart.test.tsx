import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CurrentChangeModule from '../../diff/currentChange';
import {
  CONVERTER,
  currentChange,
  down,
  expectCurrent,
  mockLayout,
  openDetailed,
  openFocus,
  up,
} from '../../test/walk';

// F-30.6 (M4 decision 15): the pause at a step's start must not survive a `↓` that pages through
// a first change taller than the screen. jsdom lays nothing out, so the diff's pager is replaced:
// every change of the converter (the first file of step 5) is two screens tall, and the pager
// keeps where in it the screen is, as `pageThrough` does on a real layout.
const tall = vi.hoisted(() => ({
  file: 'src/Mobile.App/Converters/PendingCountConverter.cs',
  screens: 2,
  at: new Map<string, number>(),
}));

vi.mock('../../diff/currentChange', async (importOriginal) => {
  const original = await importOriginal<typeof CurrentChangeModule>();
  return {
    ...original,
    pageChange: (path: string, hunk: string, direction: 1 | -1): boolean => {
      if (path !== tall.file) return false;
      const at = tall.at.get(hunk) ?? 0;
      const to = at + direction;
      if (to < 0 || to >= tall.screens) return false;
      tall.at.set(hunk, to);
      return true;
    },
  };
});

/** Lets pending key effects (a navigation) run before checking that nothing changed. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

const routerStep = (router: { state: { location: { search: string } } }) =>
  router.state.location.search;

describe('the pause at a step’s start with a tall first change (F-30.6)', () => {
  let restore: () => void;

  beforeEach(() => {
    tall.at.clear();
    restore = mockLayout();
  });

  afterEach(() => {
    restore();
  });

  it.each([
    ['S-03', openFocus, 'Step 5 of 8', 'Step 4 of 8'],
    ['S-04', openDetailed, 'Step 5 / 8', 'Step 4 / 8'],
  ] as const)(
    'F-30.6 %s ↑ ↓ ↑ at a step’s start whose first change is taller than the screen pages back, pauses again, and only then opens the previous step',
    async (_screen, open, here, previous) => {
      const { router } = await open('s5');
      await down();
      await expectCurrent((current) => {
        expect(current.file).toBe(CONVERTER);
      });
      // The pause at the step's start.
      await up();
      await settle();
      expect(routerStep(router)).toBe('?step=s5');
      // `↓` leaves the pause by scrolling a screen into the tall first change.
      await down();
      await settle();
      expect(currentChange()?.file).toBe(CONVERTER);
      expect([...tall.at.values()]).toEqual([1]);
      // `↑` pages back up through that change; the step stays.
      await up();
      await settle();
      expect(routerStep(router)).toBe('?step=s5');
      expect(screen.getByText(here)).toBeInTheDocument();
      expect(currentChange()?.file).toBe(CONVERTER);
      expect([...tall.at.values()]).toEqual([0]);
      // The change is shown to its top: the pause again, once.
      await up();
      await settle();
      expect(routerStep(router)).toBe('?step=s5');
      expect(currentChange()?.file).toBe(CONVERTER);
      // Only now the previous step opens.
      await up();
      expect(await screen.findByText(previous)).toBeInTheDocument();
      expect(routerStep(router)).toBe('?step=s4');
    },
  );
});
