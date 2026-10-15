import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { createMockClient, type MockOptions } from '../../ipc/mock';
import type { Strategy } from '../../ipc/types/Strategy';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-07.1: layout A's steps list shows the done checks of the session's reviewed steps (Review.dc.html:
// a green check square instead of the number, "3/8" in the list's head). The reviewed steps are
// session data (`PlanView.reviewed`), so these tests start the app on stored marks; what a click
// on Mark reviewed does is F-07.2. The colours of the progress segments (layouts B and C) are
// checked in tests/e2e/step.spec.ts, where CSS is applied.

const SESSION = 'mock-mr-session-1';
const TITLES = [
  'Queue contract',
  'SqliteUploadQueue',
  'UploadWorker',
  'ViewModel',
  'Offline banner',
  'DI and worker start',
  'Android',
  'Tests',
];

type MockStorage = NonNullable<MockOptions['storage']>;

function memoryStorage(): MockStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** The app started again on a session whose steps `reviewed` were marked and whose order is `strategy`. */
async function startedWith(reviewed: string[], strategy: Strategy = 'contractToUi') {
  const storage = memoryStorage();
  const before = createMockClient({ latencyMs: 0, storage });
  await before.reviewPlan(SESSION, () => undefined);
  await before.reviewSetStrategy(SESSION, strategy);
  for (const id of reviewed) await before.reviewMarkStep(SESSION, id, true);
  return createMockClient({ latencyMs: 0, storage });
}

async function openSteps(client: IpcClient, step: string | null) {
  const app = renderApp({ screen: 'S-03', sessionId: SESSION }, client);
  if (step !== null) await app.router.navigate(`/session/${SESSION}/step?step=${step}`);
  const list = await screen.findByRole('navigation', { name: 'Steps' });
  return { list, rows: within(list).getAllByRole('button') };
}

/** What a row of the list shows: a check (an icon) or its number. */
const looks = (rows: HTMLElement[]) =>
  rows.map((row) => ({
    check: row.querySelector('svg') !== null,
    numbered: /^\d/.test(row.textContent),
  }));

describe('S-03 layout A done checks', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-07.1 layout A shows a check instead of the number on each reviewed step, and counts them', async () => {
    const { list, rows } = await openSteps(await startedWith(['s1', 's2', 's3']), 's4');
    expect(rows).toHaveLength(8);
    expect(looks(rows)).toEqual([
      { check: true, numbered: false },
      { check: true, numbered: false },
      { check: true, numbered: false },
      { check: false, numbered: true },
      { check: false, numbered: true },
      { check: false, numbered: true },
      { check: false, numbered: true },
      { check: false, numbered: true },
    ]);
    rows.forEach((row, i) => {
      expect(row).toHaveTextContent(TITLES[i] ?? '');
    });
    expect(rows[3]).toHaveAttribute('aria-current', 'step');
    expect(rows[3]).toHaveTextContent('4ViewModel');
    expect(list).toHaveTextContent('3/8');
  });

  it('F-07.1 layout A with nothing reviewed has no checks and counts 0/8', async () => {
    const { list, rows } = await openSteps(await startedWith([]), 's4');
    expect(looks(rows).every((row) => !row.check && row.numbered)).toBe(true);
    expect(list).toHaveTextContent('0/8');
  });

  it('F-07.1 layout A keeps the current step yellow with its number even when it is reviewed', async () => {
    const { list, rows } = await openSteps(await startedWith(['s4']), 's4');
    expect(rows[3]).toHaveAttribute('aria-current', 'step');
    expect(rows[3]).toHaveTextContent('4ViewModel');
    expect(looks(rows).filter((row) => row.check)).toHaveLength(0);
    expect(list).toHaveTextContent('1/8');
  });

  it('F-07.1 layout A puts the check on the reviewed step, not on the position, when the order changes', async () => {
    // Tests first: Tests (s8) is step 1 and the current one, Queue contract (s1) is step 2.
    const { rows } = await openSteps(await startedWith(['s1'], 'testsFirst'), null);
    expect(rows[0]).toHaveAttribute('aria-current', 'step');
    expect(rows[0]).toHaveTextContent('1Tests');
    expect(rows[1]).toHaveTextContent('Queue contract');
    expect(looks(rows).map((row) => row.check)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(looks(rows)[1]?.numbered).toBe(false);
  });
});
